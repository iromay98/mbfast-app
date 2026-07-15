import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { storage, type StoredFile } from "@/server/storage";
import { encryptSlave, decryptSlave } from "@/server/autotuner/client";
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
      oriFilePath: true,
      oriFileHash: true,
      slaveFilePath: true,
      autotunerSlaveId: true,
      autotunerEcuId: true,
      autotunerModelId: true,
      autotunerMcuId: true,
      carModel: true,
      customerName: true,
      workedAt: true,
      backupSupported: true,
      isTuned: true,
      unit: true,
      dealer: { select: { name: true } },
      matchedBaseFile: {
        select: { model: true, generation: true, calNumber: true, method: true, tool: true, },
      },
    },
  });
  if (!record) return new Response("Not Found", { status: 404 });
  if (user.role === "DEALER" && user.dealerId !== record.dealerId) {
    return new Response("Forbidden", { status: 403 });
  }

  // mode=backup: 純正戻しを「bak(フル)」形式で作る（マップスイッチ車の完全復元用）。
  // 元スレーブを decrypt(backup) してフルの純正バックアップを得て、それを encrypt(backup)。
  const mode = request.nextUrl.searchParams.get("mode") === "backup" ? "backup" : "maps";

  // ori の実体:
  //   通常（純正読み）  → 復号ファイル（その車から読んだ元の中身）
  //   チューニング済み車 → 本店が事前アップした純正bin（読んだ中身は純正でないため）
  const srcPath = record.isTuned ? record.oriFilePath : record.decryptedFilePath;
  const srcHash = record.isTuned ? record.oriFileHash : record.decryptedHash;
  if (!srcPath) {
    return new Response(
      record.isTuned
        ? "この車はチューニング済み読みのため、本店が純正(ori)binを登録するとDLできるようになります"
        : "純正(復号)ファイルがありません",
      { status: 409 },
    );
  }
  const slaveId = record.autotunerSlaveId;
  const ecuId = record.autotunerEcuId;
  const modelId = record.autotunerModelId;
  const mcuId = record.autotunerMcuId;
  if (!slaveId || ecuId == null || modelId == null || !mcuId) {
    return new Response("この記録には暗号化に必要な情報がありません", { status: 409 });
  }

  if (mode === "backup") {
    if (record.isTuned) {
      return new Response(
        "チューニング済み読みの車はbak形式の純正戻しを作れません（本店登録の純正はマップ形式のため）",
        { status: 409 },
      );
    }
    if (record.backupSupported === false) {
      return new Response("このECUは backup（フル読み書き）に対応していません", { status: 412 });
    }
    if (!record.slaveFilePath) return new Response("Not Found", { status: 404 });
    const bakCache = `records/stock-encrypted/${recordId}__${slaveId}__bak.slave`;
    let bakSlave = (await storage.read(bakCache))?.buffer ?? null;
    if (!bakSlave) {
      // 純正のフルバックアップ（decrypt mode=backup）。既存キャッシュがあれば使う。
      let bakBin = (await storage.read(`decrypted-bak/${recordId}.bin`))?.buffer ?? null;
      if (!bakBin) {
        const slave = await storage.read(record.slaveFilePath);
        if (!slave) return new Response("Not Found", { status: 404 });
        try {
          const dec = await decryptSlave(slave.buffer, { recordId, mode: "backup" });
          bakBin = dec.decryptedData;
          await storage.save(`decrypted-bak/${recordId}.bin`, bakBin, "application/octet-stream");
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          return new Response(`bak復号に失敗しました: ${msg}`, { status: 502 });
        }
      }
      try {
        const enc = await encryptSlave(
          bakBin,
          { slaveId, ecuId, modelId, mcuId },
          { recordId, mode: "backup" },
        );
        bakSlave = enc.slaveData;
        await storage.save(bakCache, bakSlave, "application/octet-stream");
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
    const bakName = buildDownloadName({
      model: record.matchedBaseFile?.model ?? record.carModel,
      generation: record.matchedBaseFile?.generation,
      method: record.matchedBaseFile?.method,
      tool: record.matchedBaseFile?.tool ?? undefined,
      content: "ori_bak",
      unit: record.unit,
      ext: "slave",
      dealerName: record.dealer?.name,
      customerName: record.customerName,
      dateLabel: dateLabel(record.workedAt),
    });
    const outBak: StoredFile = {
      buffer: bakSlave,
      contentType: "application/octet-stream",
      size: bakSlave.byteLength,
    };
    return fileResponse(outBak, bakName, outBak.contentType);
  }

  // キャッシュ: 同じ純正(hash) × 同じ車(slaveId)
  const cacheKey = `records/stock-encrypted/${srcHash ?? recordId}__${slaveId}.slave`;
  let slaveData: Buffer;
  const cached = await storage.read(cacheKey);
  if (cached) {
    slaveData = cached.buffer;
  } else {
    const stock = await storage.read(srcPath);
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
    fileHash: srcHash,
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
    tool: record.matchedBaseFile?.tool ?? undefined,
    // 配るのは常に純正＝ori（チューンド車は本店アップの純正を配るため ori）。
    content: "ori",
    unit: record.unit,
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
