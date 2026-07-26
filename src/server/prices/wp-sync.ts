// 価格マスター → WordPress固定ページ 同期エンジン（Step C）。
//
// 仕組み:
//   1. ページに紐づく全ブランド（mercedesは2ブランド→1ページ）のHTMLをDBから生成
//   2. payload_hash（正規化後sha256）が直前の成功と同じなら送信スキップ
//   3. ライブページの content.raw を取得し、各ブランドの wp:html ブロックを特定して差し替え
//      （ブロックはブランドのラッパーclass属性で特定。見つからなければエラー＝WP未変更）
//   4. dry-run では差分概要のみ返す。確定時のみ POST し、成功時に置換前全文を backup として記録
//
// WPエディタは保存時に絵文字を数値文字参照へ再エンコードするため、比較・ハッシュは正規化後に行う。

import { createHash } from "node:crypto";
import { prisma } from "@/lib/db";
import { generatePriceTableHtml } from "@/lib/prices/generate-html";
import { normalizeEntities, parseWpHtmlBlocks, theadSequence, wrapperMarker } from "@/lib/prices/wp-blocks";
import { fetchPageRaw, updatePageContent, wpConfigured } from "@/lib/prices/wordpress";
import { toColumns, toPrices, toRemote, type BrandRow, type VehicleRow } from "@/lib/prices/types";

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

export type BrandDiff = {
  brandId: string;
  displayName: string;
  found: boolean; // ページ内に対象ブロックがあるか
  changed: boolean; // 正規化後に差分があるか
  oldBytes: number;
  newBytes: number;
  excerpt?: string; // 最初の差分行の前後
};

export type SyncResult = {
  ok: boolean;
  // guarded = 列構成(thead)がライブと不一致のため書き込みを保留（自動同期のガード）
  status: "success" | "skipped" | "failed" | "dry-run" | "guarded";
  pageId: number;
  brands: BrandDiff[];
  payloadHash: string;
  error?: string;
  lastSync?: { at: string; status: string } | null;
};

async function loadBrandsForPage(pageId: number): Promise<{ brand: BrandRow; vehicles: VehicleRow[] }[]> {
  const rows = await prisma.priceBrand.findMany({
    where: { wordPressPageId: pageId },
    orderBy: { displayOrder: "asc" },
    include: { vehicles: { where: { market: "JP" }, orderBy: { displayOrder: "asc" } } },
  });
  return rows.map((b) => ({
    brand: {
      id: b.id,
      displayName: b.displayName,
      slug: b.slug,
      namespacePrefix: b.namespacePrefix,
      seriesGroups: b.seriesGroups,
      columns: toColumns(b.columns),
      intro: b.intro ?? "",
      jsonLdDescription: b.jsonLdDescription ?? "",
      wordPressPageId: b.wordPressPageId,
      vehicleCount: b.vehicles.length,
    },
    vehicles: b.vehicles.map((v) => ({
      id: v.id,
      seriesGroup: v.seriesGroup,
      carName: v.carName,
      grade: v.grade,
      engine: v.engine,
      engineFamily: v.engineFamily,
      ecuType: v.ecuType,
      stockOutput: v.stockOutput,
      stage1Gain: v.stage1Gain,
      prices: toPrices(v.prices),
      labor: v.labor,
      shops: v.shops,
      remote: toRemote(v.remote),
      notes: v.notes,
      displayOrder: v.displayOrder,
    })),
  }));
}

// 最初の差分行の前後を短く抜き出す（プレビュー表示用）
function firstDiffExcerpt(oldHtml: string, newHtml: string): string | undefined {
  const a = normalizeEntities(oldHtml).split("\n");
  const b = normalizeEntities(newHtml).split("\n");
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (a[i] !== b[i]) {
      const clip = (s: string | undefined) => (s ?? "(行なし)").trim().slice(0, 160);
      return `L${i + 1}\n− ${clip(a[i])}\n＋ ${clip(b[i])}`;
    }
  }
  return undefined;
}

/**
 * ページ単位の同期。dryRun=true なら差分計算のみ（WP・ログとも書き込まない）。
 * force=true は payload_hash によるスキップを無効化（手動でWPが編集されたときの復旧用）。
 * guardThead=true は列構成(thead)がライブと不一致のブランドがあれば書き込まず "guarded" を返す
 * （自動同期用の安全装置。ライブの手動並び替えを勝手に巻き戻さない）。
 */
export async function syncWpPage(
  pageId: number,
  opts: { dryRun: boolean; force?: boolean; guardThead?: boolean },
): Promise<SyncResult> {
  const empty: BrandDiff[] = [];
  if (!wpConfigured()) {
    return { ok: false, status: "failed", pageId, brands: empty, payloadHash: "", error: "WP_USER / WP_APP_PASSWORD が未設定です" };
  }

  const pairs = await loadBrandsForPage(pageId);
  if (pairs.length === 0) {
    return { ok: false, status: "failed", pageId, brands: empty, payloadHash: "", error: `ページ${pageId}に紐づくブランドがありません` };
  }

  // 1. 生成
  const snippets = pairs.map(({ brand, vehicles }) => ({
    brand,
    html: generatePriceTableHtml(brand, vehicles),
  }));
  const payloadHash = sha256(snippets.map((s) => normalizeEntities(s.html)).join("\n<!-- ▲ -->\n"));

  const lastSuccess = await prisma.priceSyncLog.findFirst({
    where: { wpPageId: pageId, status: "success" },
    orderBy: { createdAt: "desc" },
    select: { payloadHash: true, createdAt: true, status: true },
  });
  const lastSync = lastSuccess ? { at: lastSuccess.createdAt.toISOString(), status: lastSuccess.status } : null;

  // 2. 同一ハッシュならスキップ（dry-runは常にライブと突き合わせて差分を見せる）
  if (!opts.dryRun && !opts.force && lastSuccess?.payloadHash === payloadHash) {
    await prisma.priceSyncLog.create({
      data: { wpPageId: pageId, brandIds: pairs.map((p) => p.brand.id), payloadHash, status: "skipped" },
    });
    return { ok: true, status: "skipped", pageId, brands: empty, payloadHash, lastSync };
  }

  // 3. ライブ取得 → ブロック特定 → 差し替え
  let raw: string;
  try {
    raw = (await fetchPageRaw(pageId)).raw;
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    if (!opts.dryRun) {
      await prisma.priceSyncLog.create({
        data: { wpPageId: pageId, brandIds: pairs.map((p) => p.brand.id), payloadHash, status: "failed", error },
      });
    }
    return { ok: false, status: "failed", pageId, brands: empty, payloadHash, error, lastSync };
  }

  const blocks = parseWpHtmlBlocks(raw);
  const diffs: BrandDiff[] = [];
  const replacements: { innerStart: number; innerEnd: number; newInner: string }[] = [];

  for (const { brand, html } of snippets) {
    const marker = wrapperMarker(html);
    const block = blocks.find((bl) => bl.inner.includes(marker));
    if (!block) {
      diffs.push({ brandId: brand.id, displayName: brand.displayName, found: false, changed: false, oldBytes: 0, newBytes: html.length });
      continue;
    }
    // 既存ブロックの前後空白（\n）を保ち、中身だけ差し替える
    const lead = /^\s*/.exec(block.inner)?.[0] ?? "";
    const trail = /\s*$/.exec(block.inner)?.[0] ?? "";
    const newInner = lead + html.trim() + (trail || "\n");
    const changed = normalizeEntities(newInner) !== normalizeEntities(block.inner);
    diffs.push({
      brandId: brand.id,
      displayName: brand.displayName,
      found: true,
      changed,
      oldBytes: block.inner.length,
      newBytes: newInner.length,
      excerpt: changed ? firstDiffExcerpt(block.inner, newInner) : undefined,
    });
    if (changed) replacements.push({ innerStart: block.innerStart, innerEnd: block.innerEnd, newInner });
  }

  // 列構成ガード（自動同期用）: 変更があるブランドで thead がライブと違えば書き込まない
  if (opts.guardThead) {
    const mismatched: string[] = [];
    for (const { brand, html } of snippets) {
      const marker = wrapperMarker(html);
      const block = blocks.find((bl) => bl.inner.includes(marker));
      if (!block) continue; // ブロック未検出は下の missing 判定に任せる
      const liveSeq = theadSequence(block.inner);
      const genSeq = theadSequence(html);
      const same = liveSeq.length === genSeq.length && genSeq.every((x, i) => x === liveSeq[i]);
      if (!same) mismatched.push(brand.displayName);
    }
    if (mismatched.length > 0) {
      const error = `列構成(thead)がライブと不一致のため自動同期を保留: ${mismatched.join(", ")}（WPは変更していません。/hq/prices から差分を確認して手動同期してください）`;
      if (!opts.dryRun) {
        await prisma.priceSyncLog.create({
          data: { wpPageId: pageId, brandIds: pairs.map((p) => p.brand.id), payloadHash, status: "guarded", error },
        });
      }
      return { ok: false, status: "guarded", pageId, brands: diffs, payloadHash, error, lastSync };
    }
  }

  const missing = diffs.filter((d) => !d.found);
  if (missing.length > 0) {
    const error = `対象ブロックが見つかりません: ${missing.map((d) => d.displayName).join(", ")}（iframe置換(Step D)が未実施のページです。WPは変更していません）`;
    if (!opts.dryRun) {
      await prisma.priceSyncLog.create({
        data: { wpPageId: pageId, brandIds: pairs.map((p) => p.brand.id), payloadHash, status: "failed", error },
      });
    }
    return { ok: false, status: opts.dryRun ? "dry-run" : "failed", pageId, brands: diffs, payloadHash, error, lastSync };
  }

  if (opts.dryRun) {
    return { ok: true, status: "dry-run", pageId, brands: diffs, payloadHash, lastSync };
  }

  if (replacements.length === 0) {
    // ライブと完全一致（初回同期などhash記録だけ更新）
    await prisma.priceSyncLog.create({
      data: { wpPageId: pageId, brandIds: pairs.map((p) => p.brand.id), payloadHash, status: "success", backup: raw },
    });
    return { ok: true, status: "success", pageId, brands: diffs, payloadHash, lastSync };
  }

  // 4. 後ろから順に差し替えてオフセットを崩さない
  let newContent = raw;
  for (const r of replacements.sort((a, b) => b.innerStart - a.innerStart)) {
    newContent = newContent.slice(0, r.innerStart) + r.newInner + newContent.slice(r.innerEnd);
  }

  try {
    await updatePageContent(pageId, newContent);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    await prisma.priceSyncLog.create({
      data: { wpPageId: pageId, brandIds: pairs.map((p) => p.brand.id), payloadHash, status: "failed", error },
    });
    return { ok: false, status: "failed", pageId, brands: diffs, payloadHash, error, lastSync };
  }

  await prisma.priceSyncLog.create({
    data: { wpPageId: pageId, brandIds: pairs.map((p) => p.brand.id), payloadHash, status: "success", backup: raw },
  });
  return { ok: true, status: "success", pageId, brands: diffs, payloadHash, lastSync };
}
