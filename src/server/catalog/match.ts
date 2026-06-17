import { prisma } from "@/lib/db";
import { storage } from "@/server/storage";
import { notify } from "@/server/notifications";
import { extractEcuId } from "@/server/ecu/identify";
import { normalizeManufacturer, isMercedes } from "@/lib/catalog/manufacturers";

type CaptureMeta = {
  manufacturer?: string | null;
  model?: string | null;
  ecu?: string | null;
  mcu?: string | null;
  generation?: string | null; // engine.version（例 8V）
  method?: string | null; // 読み方式（例 OBD）
  fuel?: string | null; // engine.fuel（petrol/diesel 等）
};

type MatchResult = { matched: boolean; captured: boolean; availableCount: number };
const NONE: MatchResult = { matched: false, captured: false, availableCount: 0 };

/**
 * 復号後の内容ハッシュ(stockHash)でカタログ(BaseFile)を照合する。
 * - 一致: 施工記録に matchedBaseFileId を紐付け。配布可(AVAILABLE)があれば代理店へ通知。
 * - 未一致 かつ キャプチャ材料(meta + 原本バイト/キー)あり: 「未整備ストック」として
 *   BaseFile を自動取込（source=AUTO_CAPTURE、原本実体も保存）し、本店へ通知。
 * カタログ全体は露出しない（代理店に出るのは AVAILABLE な mod のみ）。
 */
export async function matchAndLinkCatalog(opts: {
  recordId: string;
  hash: string | null | undefined;
  dealerId: string;
  dealerName?: string | null;
  meta?: CaptureMeta;
  stockBytes?: Buffer;
  stockKey?: string;
  contentType?: string | null;
}): Promise<MatchResult> {
  const { recordId, hash } = opts;
  if (!hash) return NONE;

  // 1) 既存カタログと照合
  const base = await prisma.baseFile.findUnique({
    where: { stockHash: hash },
    select: { id: true },
  });
  if (base) {
    const availableCount = await prisma.tunedVariant.count({
      where: { baseFileId: base.id, status: "AVAILABLE", deletedAt: null },
    });
    await prisma.serviceRecord.update({
      where: { id: recordId },
      data: { matchedBaseFileId: base.id },
    });
    // 一致時は代理店へ通知（.slave でその場DL可）。
    if (availableCount > 0) {
      await notify({
        type: "CATALOG_MATCH",
        title: "適合するチューニング済みファイルがあります",
        message: `照合一致：配布可 ${availableCount} 件。施工記録から .slave をダウンロードできます。`,
        dealerId: opts.dealerId,
        link: `/dealer/records/${recordId}`,
      });
    }
    return { matched: true, captured: false, availableCount };
  }

  // 2) 未一致 → 自動キャプチャ（材料が揃っている場合のみ）
  if (!opts.meta) return NONE;

  let bytes = opts.stockBytes ?? null;
  let contentType = opts.contentType ?? "application/octet-stream";
  if (!bytes && opts.stockKey) {
    const f = await storage.read(opts.stockKey);
    if (f) {
      bytes = f.buffer;
      contentType = f.contentType;
    }
  }
  if (!bytes) return NONE;

  const stockKey = `catalog/stock/${hash.toLowerCase()}.bin`;
  await storage.save(stockKey, bytes, contentType);

  // 原本バイトから ECU 識別子（HW/SW/Cal）を抽出。
  // ベンツは自動認識が Cal を誤検出するため抽出しない（本店が手入力）。
  const ecu = isMercedes(opts.meta.manufacturer)
    ? { hw: null, sw: null, cal: null }
    : extractEcuId(bytes);

  // 同一 SW・別内容(hash) の通し番号を採番（0=無印, 1=-A, …）。
  // hash は一意なので「同SWの既存件数」がそのまま新規の連番になる。
  const swSeq = ecu.sw
    ? await prisma.baseFile.count({ where: { swNumber: ecu.sw } })
    : 0;

  try {
    const created = await prisma.baseFile.create({
      data: {
        stockHash: hash,
        // メーカー表記を正規化（Mercedes系は "Mercedes" に統合 等）
        manufacturer: opts.meta.manufacturer
          ? normalizeManufacturer(opts.meta.manufacturer)
          : "(不明)",
        model: opts.meta.model || "(不明)",
        ecu: opts.meta.ecu || "(不明)",
        mcu: opts.meta.mcu || null,
        hwNumber: ecu.hw,
        swNumber: ecu.sw,
        swSeq,
        calNumber: ecu.cal,
        generation: opts.meta.generation || null,
        method: opts.meta.method || null,
        fuel: opts.meta.fuel || null,
        source: "AUTO_CAPTURE",
        stockFileRef: stockKey,
        stockFileName: `stock_${hash.slice(0, 12)}.bin`,
        stockFileSize: bytes.byteLength,
        stockContentType: contentType,
        capturedFromRecordId: recordId,
        note: "自動取込（未整備ストック）",
      },
    });
    await prisma.serviceRecord.update({
      where: { id: recordId },
      data: { matchedBaseFileId: created.id },
    });
    await notify({
      type: "STOCK_CAPTURED",
      title: "未整備ストックを取り込みました（要mod登録）",
      message: `${opts.meta.manufacturer ?? ""} ${opts.meta.model ?? ""}（${opts.meta.ecu ?? ""}）`,
      dealerId: null, // 本店宛て
      link: "/hq/catalog/pending",
    });
    return { matched: false, captured: true, availableCount: 0 };
  } catch {
    // stockHash 一意制約の競合（並行復号）→ 再 find して link
    const again = await prisma.baseFile.findUnique({
      where: { stockHash: hash },
      select: { id: true },
    });
    if (again) {
      await prisma.serviceRecord.update({
        where: { id: recordId },
        data: { matchedBaseFileId: again.id },
      });
      return { matched: true, captured: false, availableCount: 0 };
    }
    return NONE;
  }
}
