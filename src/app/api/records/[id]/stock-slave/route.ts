import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { storage, type StoredFile } from "@/server/storage";
import { encryptSlave } from "@/server/autotuner/client";
import { fileResponse, logCatalogDownload } from "@/server/catalog/download-log";
import { buildDownloadName, dateLabel } from "@/server/catalog/filename";

// 純正(ori)に戻す .slave。slaveアップ時の復号ファイル（その車の元の中身）を、
// その車固有ID(復号時保存)で再encryptして焼ける .slave として配信。バリエーションとは別物。
// いつでもDL可（施工料金の対象外＝純正へ戻すため）。本店は全件、代理店は自店のみ。
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id: recordId } = await ctx.params;
  const record = await prisma.serviceRecord.findUnique({
    where: { id: recordId },
    select: {
      dealerId: true,
      decryptedFilePath: true,
      decryptedHash: true,
      autotunerSlaveId: true,
      autotunerEcuId: true,
      autotunerModelId: true,
      autotunerMcuId: true,
      carModel: true,
      customerName: true,
      workedAt: true,
      backupSupported: true,
      isTuned: true,
      dealer: { select: { name: true } },
      matchedBaseFile: {
        select: { model: true, generation: true, calNumber: true, method: true },
      },
    },
  });
  if (!record) return new Response("Not Found", { status: 404 });
  if (user.role === "DEALER" && user.dealerId !== record.dealerId) {
    return new Response("Forbidden", { status: 403 });
  }

  if (!record.decryptedFilePath) {
    return new Response("純正(復号)ファイルがありません", { status: 409 });
  }
  const slaveId = record.autotunerSlaveId;
  const ecuId = record.autotunerEcuId;
  const modelId = record.autotunerModelId;
  const mcuId = record.autotunerMcuId;
  if (!slaveId || ecuId == null || modelId == null || !mcuId) {
    return new Response("この記録には暗号化に必要な情報がありません", { status: 409 });
  }

  // キャッシュ: 同じ純正(decryptedHash) × 同じ車(slaveId)
  const cacheKey = `records/stock-encrypted/${record.decryptedHash ?? recordId}__${slaveId}.slave`;
  let slaveData: Buffer;
  const cached = await storage.read(cacheKey);
  if (cached) {
    slaveData = cached.buffer;
  } else {
    const stock = await storage.read(record.decryptedFilePath);
    if (!stock) return new Response("Not Found", { status: 404 });
    try {
      const enc = await encryptSlave(stock.buffer, { slaveId, ecuId, modelId, mcuId }, { recordId });
      slaveData = enc.slaveData;
      await storage.save(cacheKey, slaveData, "application/octet-stream");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return new Response(`暗号化に失敗しました: ${msg}`, { status: 502 });
    }
  }

  await logCatalogDownload({
    variantId: null,
    fileHash: record.decryptedHash,
    userId: user.id,
    dealerId: record.dealerId,
    serviceRecordId: recordId,
    context: user.role === "HQ_ADMIN" ? "HQ_MANUAL" : "MATCH_AUTO",
    ip: request.headers.get("x-forwarded-for"),
  });

  const name = buildDownloadName({
    model: record.matchedBaseFile?.model ?? record.carModel,
    generation: record.matchedBaseFile?.generation,
    // 施工記録ページからのDLは Cal を出さない（命名規則: 車種 店名(顧客名 日付) AT_方法_内容）
    method: record.matchedBaseFile?.method,
    // チューニング済み→tuned / リアル読み(backup可)→backup / ヴァーチャル→ori
    content: record.isTuned ? "tuned" : record.backupSupported ? "backup" : "ori",
    ext: "slave",
    dealerName: record.dealer?.name,
    customerName: record.customerName,
    dateLabel: dateLabel(record.workedAt),
  });
  const out: StoredFile = {
    buffer: slaveData,
    contentType: "application/octet-stream",
    size: slaveData.byteLength,
  };
  return fileResponse(out, name, out.contentType);
}
