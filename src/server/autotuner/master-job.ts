import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { storage } from "@/server/storage";
import { notify } from "@/server/notifications";
import { matchAndLinkCatalog } from "@/server/catalog/match";
import { smartExtractEcuId } from "@/server/ecu/learn";
import { aiAnalyzeStock } from "@/server/ecu/ai-extract";

// revalidatePath はリクエストスコープ外だと例外を投げるので包む。
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
 * Master File（Powergate3・生bin）取込ジョブ。
 * スレーブ復号と違い外部APIは使わない。アップされた生bin＝復号後の中身そのものとして扱い、
 * SHA-256でカタログ照合する。一致すれば配布可バリエーションが記録に紐づく。
 * 未一致なら AI で車両/識別子を推定し、未整備ストックとして自動取込（本店が mod を作れる）。
 * 状態遷移: UPLOADED → DECRYPTING → DECODED / FAILED
 */
export async function runMasterFileJob(recordId: string): Promise<void> {
  const record = await prisma.serviceRecord.findUnique({
    where: { id: recordId },
    select: {
      id: true,
      dealerId: true,
      slaveFilePath: true, // Master File 実体（生bin）を保存しているキー
      unit: true,
      dealer: { select: { name: true } },
    },
  });
  if (!record || !record.slaveFilePath) return;

  await prisma.serviceRecord.update({
    where: { id: recordId },
    data: { status: "DECRYPTING", decryptError: null },
  });
  safeRevalidate("/dealer/records", "/hq/records");

  try {
    const f = await storage.read(record.slaveFilePath);
    if (!f) throw new Error("マスターファイルが見つかりません");
    const buf = f.buffer;

    // 生bin＝中身そのもの。復号は不要。SHA-256 が照合キー。
    const hash = createHash("sha256").update(buf).digest("hex").toUpperCase();
    const decryptedKey = `decrypted/${recordId}.bin`;
    await storage.save(decryptedKey, buf, "application/octet-stream");

    // 識別（パターン下読み → AIで車両・HW/SW/Cal）。純正(ori)前提。
    const pattern = await smartExtractEcuId(buf, { hash, ecuType: null });
    const ai = await aiAnalyzeStock(buf, {
      hash,
      swHint: pattern.sw,
      calHint: pattern.cal,
      engineDesc: pattern.engineDesc,
    });
    const hwNumber = ai?.hw ?? pattern.hw;
    const swNumber = ai?.sw ?? pattern.sw;
    const calNumber = ai?.cal ?? pattern.cal;
    // 燃料はエンジン記述から推定（照合の補助メタ）。
    const desc = pattern.engineDesc ?? "";
    const fuel = /TDI|diesel/i.test(desc)
      ? "diesel"
      : /TFSI|TSI|FSI|petrol|gasoline/i.test(desc)
        ? "petrol"
        : null;

    await prisma.serviceRecord.update({
      where: { id: recordId },
      data: {
        status: "DECODED",
        decryptError: null,
        decryptedFilePath: decryptedKey,
        decryptedHash: hash,
        carMaker: ai?.manufacturer ?? null,
        carModel: ai?.model ?? null,
        hwNumber,
        swNumber,
        calNumber,
        idSource: ai?.cal ? "AI" : pattern.cal || pattern.sw || pattern.hw ? "PATTERN" : null,
        idConfidence: ai?.confidence ?? null,
      },
    });

    // カタログ照合（+未一致なら未整備ストックへ自動取込）。Master File は純正読みなので取込可。
    await matchAndLinkCatalog({
      recordId,
      hash,
      dealerId: record.dealerId,
      dealerName: record.dealer?.name,
      meta: {
        manufacturer: ai?.manufacturer ?? null,
        model: ai?.model ?? null,
        ecu: pattern.ecuType ?? null,
        mcu: null,
        generation: ai?.generation ?? null,
        method: null,
        fuel,
      },
      ecuIds: { hw: hwNumber, sw: swNumber, cal: calNumber },
      skipCapture: false, // Master File は純正(ori)
      unit: record.unit,
      stockBytes: buf,
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
      title: "マスターファイルを取り込みました",
      message: `${record.dealer?.name ?? "代理店"}：${ai?.manufacturer ?? ""} ${ai?.model ?? ""}`.trim(),
      dealerId: null, // 本店宛て
      link: `/hq/records/${recordId}`,
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await prisma.serviceRecord.update({
      where: { id: recordId },
      data: { status: "FAILED", decryptError: message },
    });
    safeRevalidate("/dealer/records", "/hq/records", `/dealer/records/${recordId}`);

    await notify({
      type: "SLAVE_DECRYPT_FAILED",
      title: "マスターファイルの取込に失敗しました",
      message: `${record.dealer?.name ?? "代理店"}：${message}`,
      dealerId: null,
      link: `/hq/records/${recordId}`,
    });
  }
}
