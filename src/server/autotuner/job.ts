import { revalidatePath } from "next/cache";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { storage } from "@/server/storage";
import { notify } from "@/server/notifications";
import { matchAndLinkCatalog } from "@/server/catalog/match";
import { smartExtractEcuId, getConfirmedIds } from "@/server/ecu/learn";
import { aiExtractIds } from "@/server/ecu/ai-extract";
import { decryptSlave } from "./client";
import { AutotunerError, type DecryptResponse } from "./types";

// revalidatePath はリクエストスコープ外だと例外を投げる。ジョブ本体を止めないよう包む
// （UI 更新はクライアントの AutoRefresh ポーリングでも担保される）。
function safeRevalidate(...paths: string[]): void {
  for (const p of paths) {
    try {
      revalidatePath(p);
    } catch {
      /* スコープ外なら無視 */
    }
  }
}

/*
 * スレーブ復号のバックグラウンドジョブ。
 * upload アクションから Next.js の after() 経由で呼ばれる（レスポンス後に実行）。
 * 状態遷移: UPLOADED → DECRYPTING → DECODED / FAILED
 */
export async function runDecryptJob(recordId: string): Promise<void> {
  const record = await prisma.serviceRecord.findUnique({
    where: { id: recordId },
    select: { id: true, dealerId: true, slaveFilePath: true, status: true, isTuned: true, dealer: { select: { name: true } } },
  });
  if (!record || !record.slaveFilePath) return;

  // DECRYPTING へ
  await prisma.serviceRecord.update({
    where: { id: recordId },
    data: { status: "DECRYPTING", decryptError: null },
  });
  safeRevalidate("/dealer/records", "/hq/records");

  try {
    const slave = await storage.read(record.slaveFilePath);
    if (!slave) throw new AutotunerError("スレーブファイルが見つかりません", null, "NETWORK");

    const result = await decryptSlave(slave.buffer, { recordId });

    // 復号バイナリを保存
    const decryptedKey = `decrypted/${recordId}.bin`;
    await storage.save(decryptedKey, result.decryptedData, "application/octet-stream");

    // 復号後バイナリから ECU 識別子（HW/SW/Cal）を識別。
    // 全メーカーAI主体: パターン抽出を下読み(SWヒント/フォールバック)に使い、
    // ANTHROPIC_API_KEY があれば Claude(Haiku→不確実ならOpus)で識別。AIがCalを出せばAI優先。
    const pattern = await smartExtractEcuId(result.decryptedData, {
      hash: result.hash,
      ecuType: result.meta.ecu,
      manufacturer: result.meta.manufacturer, // ベンツはパターン無効
    });
    const ai = await aiExtractIds(result.decryptedData, {
      hash: result.hash,
      manufacturer: result.meta.manufacturer,
      ecuType: result.meta.ecu,
      method: result.meta.method,
      swHint: pattern.sw,
      calHint: pattern.cal, // パターンが出したCal（VAG等）をAIに検証させる
      engineCode: pattern.engineCode,
      engineDesc: pattern.engineDesc ?? result.meta.model,
    });
    // 本店が確定(EXACT)した値は最優先（AIより上）＝修正の自己学習。
    const confirmed = await getConfirmedIds(result.hash);
    const isConfirmed = !!(confirmed.cal || confirmed.sw || confirmed.hw);
    const useAi = !isConfirmed && !!ai?.cal;
    const hwNumber = confirmed.hw ?? ai?.hw ?? pattern.hw;
    const swNumber = confirmed.sw ?? ai?.sw ?? pattern.sw;
    const calNumber = confirmed.cal ?? ai?.cal ?? pattern.cal;
    const idSource = isConfirmed
      ? "MANUAL"
      : useAi
        ? "AI"
        : pattern.cal || pattern.sw || pattern.hw
          ? "PATTERN"
          : null;
    const idConfidence = useAi ? (ai?.confidence ?? null) : null;

    await prisma.serviceRecord.update({
      where: { id: recordId },
      data: {
        ...mapMetaToRecord(result.meta, result.hash, decryptedKey),
        hwNumber,
        swNumber,
        calNumber,
        idSource,
        idConfidence,
        ecuIdRaw: { pattern, ai } as unknown as Prisma.InputJsonValue,
      },
    });

    // カタログ照合 + 未整備ストックの自動取込（未一致なら原本も保存して台帳化）
    await matchAndLinkCatalog({
      recordId,
      hash: result.hash,
      dealerId: record.dealerId,
      dealerName: record.dealer?.name,
      meta: {
        manufacturer: result.meta.manufacturer,
        model: result.meta.model,
        ecu: result.meta.ecu,
        mcu: result.meta.mcu,
        generation: result.meta.engine?.version ?? null,
        method: result.meta.method,
        fuel: result.meta.engine?.fuel ?? null,
      },
      // 識別子は記録と同じ確定値（AI優先）を使う
      ecuIds: { hw: hwNumber, sw: swNumber, cal: calNumber },
      // チューニング済みなら純正としてカタログ自動取込しない（ori扱いにしない）
      skipCapture: record.isTuned,
      stockBytes: result.decryptedData,
      contentType: "application/octet-stream",
    });

    safeRevalidate(
      "/dealer/records",
      "/hq/records",
      `/dealer/records/${recordId}`,
      `/hq/records/${recordId}`,
    );

    await notify({
      type: "SLAVE_DECODED",
      title: "スレーブ復号が完了しました",
      message: `${record.dealer?.name ?? "代理店"}：${result.meta.manufacturer} ${result.meta.model}（${result.meta.ecu}）`,
      dealerId: null, // 本店宛て
      link: `/hq/records/${recordId}`,
    });
  } catch (e) {
    const message =
      e instanceof AutotunerError ? e.message : e instanceof Error ? e.message : String(e);
    await prisma.serviceRecord.update({
      where: { id: recordId },
      data: { status: "FAILED", decryptError: message },
    });
    safeRevalidate("/dealer/records", "/hq/records", `/dealer/records/${recordId}`);

    await notify({
      type: "SLAVE_DECRYPT_FAILED",
      title: "スレーブ復号に失敗しました",
      message: `${record.dealer?.name ?? "代理店"}：${message}`,
      dealerId: null,
      link: `/hq/records/${recordId}`,
    });
  }
}

/** decrypt レスポンス → ServiceRecord 更新データ（spec のマッピングに厳密準拠） */
export function mapMetaToRecord(
  meta: DecryptResponse,
  hash: string,
  decryptedKey: string,
): Prisma.ServiceRecordUpdateInput {
  return {
    status: "DECODED",
    decryptError: null,
    decryptedFilePath: decryptedKey,
    decryptedHash: hash,
    carMaker: meta.manufacturer,
    carModel: meta.model,
    ecuType: meta.ecu,
    mcu: meta.mcu,
    method: meta.method,
    ecuManufacturer: meta.ecu_manufacturer,
    slaveName: meta.slave_name,
    engineInfo: meta.engine as unknown as Prisma.InputJsonValue,
    backupSupported: meta.backup_supported,
    // encrypt 用識別子
    autotunerSlaveId: meta.slave_id,
    autotunerEcuId: meta.ecu_id,
    autotunerModelId: meta.model_id,
    autotunerMcuId: meta.mcu_id,
  };
}
