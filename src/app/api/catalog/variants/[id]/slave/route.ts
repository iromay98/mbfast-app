import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { storage, type StoredFile } from "@/server/storage";
import { encryptSlave } from "@/server/autotuner/client";
import { fileResponse, logCatalogDownload } from "@/server/catalog/download-log";
import { buildDownloadName, composeContent } from "@/server/catalog/filename";

// 本店専用: カタログの版(TunedVariant)を、自動取込元の車両(復号時に保存したID)で
// AutoTuner encrypt して焼ける .slave として配信する。
// 手動登録の純正など、車両IDが無いストックは .slave 化できない（409）。
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (user.role !== "HQ_ADMIN") return new Response("Forbidden", { status: 403 });

  const { id } = await ctx.params;
  const v = await prisma.tunedVariant.findUnique({
    where: { id },
    select: {
      fileRef: true,
      fileHash: true,
      currentVersionId: true,
      stage: true,
      popsAndBangs: true,
      popsSport: true,
      optionTags: true,
      baseFile: {
        select: {
          model: true,
          generation: true,
          calNumber: true,
          method: true,
          capturedFromRecordId: true,
        },
      },
    },
  });
  if (!v || !v.fileRef) return new Response("Not Found", { status: 404 });

  // 暗号化に必要な車両ID（復号時に保存）は取込元の施工記録から取得
  const recId = v.baseFile.capturedFromRecordId;
  const rec = recId
    ? await prisma.serviceRecord.findUnique({
        where: { id: recId },
        select: {
          autotunerSlaveId: true,
          autotunerEcuId: true,
          autotunerModelId: true,
          autotunerMcuId: true,
        },
      })
    : null;
  const slaveId = rec?.autotunerSlaveId;
  const ecuId = rec?.autotunerEcuId;
  const modelId = rec?.autotunerModelId;
  const mcuId = rec?.autotunerMcuId;
  if (!slaveId || ecuId == null || modelId == null || !mcuId) {
    return new Response(
      "この純正には .slave 化に必要な車両情報がありません（手動登録の純正など）。",
      { status: 409 },
    );
  }

  // キャッシュ: 同じ版(fileHash) × 同じ車(slaveId)
  const cacheKey = `catalog/encrypted/${v.fileHash ?? "nohash"}__${slaveId}.slave`;
  let slaveData: Buffer;
  const cached = await storage.read(cacheKey);
  if (cached) {
    slaveData = cached.buffer;
  } else {
    const tuned = await storage.read(v.fileRef);
    if (!tuned) return new Response("Not Found", { status: 404 });
    try {
      const enc = await encryptSlave(tuned.buffer, { slaveId, ecuId, modelId, mcuId });
      slaveData = enc.slaveData;
      await storage.save(cacheKey, slaveData, "application/octet-stream");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return new Response(`再暗号化に失敗しました: ${msg}`, { status: 502 });
    }
  }

  await logCatalogDownload({
    variantId: id,
    versionId: v.currentVersionId,
    fileHash: v.fileHash,
    userId: user.id,
    context: "HQ_MANUAL",
    ip: request.headers.get("x-forwarded-for"),
  });

  const name = buildDownloadName({
    model: v.baseFile.model,
    generation: v.baseFile.generation,
    cal: v.baseFile.calNumber, // 本店専用
    method: v.baseFile.method,
    content: composeContent(v.stage, v.popsAndBangs, v.optionTags, v.popsSport),
    ext: "slave",
  });
  const out: StoredFile = {
    buffer: slaveData,
    contentType: "application/octet-stream",
    size: slaveData.byteLength,
  };
  return fileResponse(out, name, out.contentType);
}
