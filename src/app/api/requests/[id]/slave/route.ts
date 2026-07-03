import { createHash } from "crypto";
import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { storage, type StoredFile } from "@/server/storage";
import { encryptSlave } from "@/server/autotuner/client";
import { fileResponse, logCatalogDownload } from "@/server/catalog/download-log";
import { buildDownloadName, dateLabel } from "@/server/catalog/filename";

// チケット(依頼)の成果＝現車合わせ/調整ファイルを、紐づく記録の車固有IDで encrypt して .slave で配信。
// 本店がアップした成果は「チューニング済みbin」想定。代理店には生bin/復号binは一切渡さず、必ず .slave。
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await ctx.params;
  const req = await prisma.fileRequest.findUnique({
    where: { id },
    select: {
      dealerId: true,
      resultFilePath: true,
      serviceRecord: {
        select: {
          id: true,
          carModel: true,
          method: true,
          autotunerSlaveId: true,
          autotunerEcuId: true,
          autotunerModelId: true,
          autotunerMcuId: true,
          customerName: true,
          workedAt: true,
          unit: true,
          dealer: { select: { name: true } },
        },
      },
    },
  });
  if (!req) return new Response("Not Found", { status: 404 });

  // 代理店は自店の依頼のみ。本店は全件可。
  if (user.role === "DEALER" && user.dealerId !== req.dealerId) {
    return new Response("Forbidden", { status: 403 });
  }
  if (!req.resultFilePath) return new Response("Not Found", { status: 404 });

  const rec = req.serviceRecord;
  const slaveId = rec?.autotunerSlaveId;
  const ecuId = rec?.autotunerEcuId;
  const modelId = rec?.autotunerModelId;
  const mcuId = rec?.autotunerMcuId;
  if (!rec || !slaveId || ecuId == null || modelId == null || !mcuId) {
    return new Response("この依頼には再暗号化に必要な記録情報がありません", { status: 409 });
  }

  const tuned = await storage.read(req.resultFilePath);
  if (!tuned) return new Response("Not Found", { status: 404 });
  const fileHash = createHash("sha256").update(tuned.buffer).digest("hex");

  // キャッシュ: 同じ成果(hash) × 同じ車(slaveId) の .slave は使い回す
  const cacheKey = `requests/encrypted/${fileHash}__${slaveId}.slave`;
  let slaveData: Buffer;
  const cached = await storage.read(cacheKey);
  if (cached) {
    slaveData = cached.buffer;
  } else {
    try {
      const enc = await encryptSlave(tuned.buffer, { slaveId, ecuId, modelId, mcuId }, { recordId: rec.id });
      slaveData = enc.slaveData;
      await storage.save(cacheKey, slaveData, "application/octet-stream");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return new Response(`再暗号化に失敗しました: ${msg}`, { status: 502 });
    }
  }

  await logCatalogDownload({
    variantId: null,
    versionId: null,
    fileHash,
    userId: user.id,
    dealerId: req.dealerId,
    serviceRecordId: rec.id,
    context: "HQ_MANUAL",
    ip: request.headers.get("x-forwarded-for"),
  });

  const name = buildDownloadName({
    model: rec.carModel,
    method: rec.method,
    content: "custom", // 現車合わせ/調整の1点もの
    unit: rec.unit,
    ext: "slave",
    dealerName: rec.dealer?.name,
    customerName: rec.customerName,
    dateLabel: dateLabel(rec.workedAt),
  });
  const out: StoredFile = {
    buffer: slaveData,
    contentType: "application/octet-stream",
    size: slaveData.byteLength,
  };
  return fileResponse(out, name, out.contentType);
}
