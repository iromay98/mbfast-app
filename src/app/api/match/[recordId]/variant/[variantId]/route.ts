import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { storage, type StoredFile } from "@/server/storage";
import { encryptSlave } from "@/server/autotuner/client";
import { fileResponse, logCatalogDownload } from "@/server/catalog/download-log";
import { buildDownloadName, composeContent, dateLabel } from "@/server/catalog/filename";

// 代理店向けスコープ限定DL（.slave のみ）:
//   照合した記録(recordId)に紐づく AVAILABLE な mod を、その車固有のID(復号時に保存)で
//   AutoTuner encrypt し、焼ける .slave として配信する。生bin・復号binは一切渡さない。
//   variantId は「一致した BaseFile 配下の AVAILABLE」に制約されカタログ列挙不可。
//   配信ごとに CatalogDownloadLog(MATCH_AUTO) を残す。本店承認は不要。
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ recordId: string; variantId: string }> },
) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { recordId, variantId } = await ctx.params;

  const record = await prisma.serviceRecord.findUnique({
    where: { id: recordId },
    select: {
      dealerId: true,
      matchedBaseFileId: true,
      autotunerSlaveId: true,
      autotunerEcuId: true,
      autotunerModelId: true,
      autotunerMcuId: true,
      customerName: true,
      workedAt: true,
      unit: true,
      dealer: { select: { name: true, fileFormat: true } },
    },
  });
  if (!record) return new Response("Not Found", { status: 404 });

  // 代理店は自店の記録のみ。本店は全件可。
  if (user.role === "DEALER" && user.dealerId !== record.dealerId) {
    return new Response("Forbidden", { status: 403 });
  }
  // 照合が成立していない記録からは配信しない
  if (!record.matchedBaseFileId) return new Response("Not Found", { status: 404 });

  const v = await prisma.tunedVariant.findUnique({
    where: { id: variantId },
    select: {
      baseFileId: true,
      status: true,
      deletedAt: true,
      fileRef: true,
      fileName: true,
      fileHash: true,
      currentVersionId: true,
      stage: true,
      popsAndBangs: true,
      popsSport: true,
      optionTags: true,
      baseFile: {
        select: { model: true, generation: true, calNumber: true, method: true, tool: true, unit: true },
      },
    },
  });
  // 一致した BaseFile 配下の AVAILABLE 現行ファイルに限る（それ以外は存在を秘匿して 404）
  if (
    !v ||
    v.deletedAt ||
    v.baseFileId !== record.matchedBaseFileId ||
    v.status !== "AVAILABLE" ||
    !v.fileRef
  ) {
    return new Response("Not Found", { status: 404 });
  }

  // Master File 形式の代理店(Powergate3・OBLY等)は再暗号化しない。
  // チューニング済みの生bin＝Master File をそのまま配信する（.slave化しない）。
  if (record.dealer?.fileFormat === "MASTER") {
    const tuned = await storage.read(v.fileRef);
    if (!tuned) return new Response("Not Found", { status: 404 });

    await logCatalogDownload({
      variantId,
      versionId: v.currentVersionId,
      fileHash: v.fileHash,
      userId: user.id,
      dealerId: record.dealerId,
      serviceRecordId: recordId,
      context: "MATCH_AUTO",
      ip: request.headers.get("x-forwarded-for"),
    });

    const masterName = buildDownloadName({
      model: v.baseFile.model,
      generation: v.baseFile.generation,
      method: v.baseFile.method,
      tool: v.baseFile.tool,
      content: composeContent(v.stage, v.popsAndBangs, v.optionTags, v.popsSport),
      unit: v.baseFile.unit,
      ext: "bin", // Master File は生bin
      dealerName: record.dealer?.name,
      customerName: record.customerName,
      dateLabel: dateLabel(record.workedAt),
    });
    const outMaster: StoredFile = {
      buffer: tuned.buffer,
      contentType: "application/octet-stream",
      size: tuned.buffer.byteLength,
    };
    return fileResponse(outMaster, masterName, outMaster.contentType);
  }

  // encrypt に必要なID（その車固有・復号時に保存）。揃っていなければ .slave 化できない。
  const slaveId = record.autotunerSlaveId;
  const ecuId = record.autotunerEcuId;
  const modelId = record.autotunerModelId;
  const mcuId = record.autotunerMcuId;
  if (!slaveId || ecuId == null || modelId == null || !mcuId) {
    return new Response("この記録には再暗号化に必要な情報がありません", { status: 409 });
  }

  // キャッシュ: 同じ mod(fileHash) × 同じ車(slaveId) の .slave は使い回す（毎回 encrypt しない）
  const cacheKey = `catalog/encrypted/${v.fileHash ?? "nohash"}__${slaveId}.slave`;
  let slaveData: Buffer;
  const cached = await storage.read(cacheKey);
  if (cached) {
    slaveData = cached.buffer;
  } else {
    const tuned = await storage.read(v.fileRef);
    if (!tuned) return new Response("Not Found", { status: 404 });
    try {
      const enc = await encryptSlave(
        tuned.buffer,
        { slaveId, ecuId, modelId, mcuId },
        { recordId },
      );
      slaveData = enc.slaveData;
      await storage.save(cacheKey, slaveData, "application/octet-stream");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return new Response(`再暗号化に失敗しました: ${msg}`, { status: 502 });
    }
  }

  await logCatalogDownload({
    variantId,
    versionId: v.currentVersionId,
    fileHash: v.fileHash,
    userId: user.id,
    dealerId: record.dealerId,
    serviceRecordId: recordId,
    context: "MATCH_AUTO",
    ip: request.headers.get("x-forwarded-for"),
  });

  const name = buildDownloadName({
    model: v.baseFile.model,
    generation: v.baseFile.generation,
    // 施工記録ページからのDLは Cal を出さない（命名規則: 車種 店名(顧客名 日付) AT_方法_内容）
    method: v.baseFile.method,
    tool: v.baseFile.tool,
    content: composeContent(v.stage, v.popsAndBangs, v.optionTags, v.popsSport),
    unit: v.baseFile.unit,
    ext: "slave", // 再暗号化済み＝焼ける .slave
    // 車種名の後に「代理店名(顧客名+日付)」を付与
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
