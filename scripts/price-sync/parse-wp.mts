/*
 * Step A: ライブWordPress content.raw を「正」として価格表ブロックを解析するパーサー。
 *
 *   入力 : フィクスチャHTML全文（兄弟ブロック込み）＋ { pageId, blockIndex, prefix }
 *   出力 : ParsedBlock（版面 layout ＋ 列 columns ＋ 行 rows）。DB書き込みは一切しない。
 *
 * 設計方針:
 *  - 列構成・命名・クラス/ID は全て HTML から実測する（推測しない）。
 *  - 「データを担う領域」＝ 検索/フィルタ操作部・thead・tbody は正規化値へ落として持つ
 *    （spec 2.2）。生成側(generated-template.ts)がこの値から再構成できる形。
 *  - <style>/<script>/導入文/注記/JSON-LD は版面固有の“ガワ”として実測文字列で layout に保持。
 *  - 純関数として export（roundtrip.mts / テストから使える）。末尾に CLI(要約表示)。
 *
 * data属性の注意: 行の絞り込みは <tr> の data-{p}-series、フィルタボタンは
 * data-{p}-filter-series。series は tr 側、filterSeries はボタン側。ボタン側を先に拾う
 * 事故を避けるため、series は tr 属性から / チップ一覧はボタン属性から明示的に取る。
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type {
  BrandLayout,
  CellCell,
  CellValue,
  ParsedBlock,
  ParsedColumn,
  ParsedRow,
} from "../../src/lib/prices/generated-template";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");

// ── 小道具 ───────────────────────────────────────────────────────
const stripTags = (s: string) => s.replace(/<[^>]+>/g, "");
const decodeEntitiesForText = (s: string) => s; // 比較は生文字列同士なのでエンティティは保持する

function attr(tag: string, name: string): string | null {
  const m = new RegExp(`${name}\\s*=\\s*"([^"]*)"`).exec(tag);
  return m ? m[1] : null;
}

/** blockIndex 番目の <!-- wp:html --> … <!-- /wp:html --> の中身を返す。 */
export function extractBlock(html: string, blockIndex: number): string {
  const blocks: string[] = [];
  const re = /<!-- wp:html -->([\s\S]*?)<!-- \/wp:html -->/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) blocks.push(m[1]);
  if (blockIndex >= blocks.length)
    throw new Error(`block ${blockIndex} が見つかりません（総ブロック数 ${blocks.length}）`);
  return blocks[blockIndex];
}

// ── 価格系セルの正規化（spec 2.2） ───────────────────────────────
function parseCellValue(innerHtml: string): CellValue {
  const s = innerHtml.trim();
  if (/class="[^"]*ask-btn/.test(s)) {
    // その列セルの ask-btn 実測 data-grade（同一行でも列で ★ の有無が揺れる原本ノイズを保持）
    const aTag = /<a[^>]*class="[^"]*ask-btn[^"]*"[^>]*>/.exec(s)?.[0] ?? "";
    const g = attr(aTag, "data-grade");
    return g !== null ? { kind: "ask", askGrade: g } : { kind: "ask" };
  }
  // muted の —（上位グレード非提供）
  if (/-muted"[^>]*>\s*—\s*</.test(s) || s === "—") return { kind: "not_offered" };
  const text = stripTags(s).trim();
  if (text === "") return { kind: "ask" }; // 空欄 → 価格NULL（ask）
  if (/^¥[\d,]+$/.test(text)) return { kind: "yen", value: Number(text.slice(1).replace(/,/g, "")) };
  if (/^ASK$/i.test(text)) return { kind: "ask" };
  return { kind: "raw", text: s }; // "+¥11,000" / "+¥33,000/各" / "ロック解除必要" 等
}

// ── 列の役割判定（cellクラスの接尾辞から） ───────────────────────
function roleOf(suffix: string): ParsedColumn["role"] {
  if (suffix === "cell-car") return "car";
  if (suffix === "cell-grade") return "grade";
  if (suffix === "cell-engine") return "engine";
  if (suffix === "cell-maker") return "maker";
  if (suffix.startsWith("cell-price-")) return "price";
  if (suffix === "cell-tcu") return "tcu";
  if (suffix === "cell-labor") return "labor";
  return "text";
}

// ── 本体 ─────────────────────────────────────────────────────────
export function parseWpBlock(
  html: string,
  opts: { pageId: number; blockIndex: number; prefix: string },
): ParsedBlock {
  const p = opts.prefix;
  const block = extractBlock(html, opts.blockIndex);

  // ---- 操作部の id / placeholder ----
  const searchTag = /<input[^>]*type="search"[^>]*>/.exec(block)?.[0] ?? "";
  const searchId = attr(searchTag, "id") ?? "";
  const placeholder = attr(searchTag, "placeholder") ?? "";
  const clearTag = new RegExp(`<button[^>]*class="${p}-clear"[^>]*>`).exec(block)?.[0] ?? "";
  const clearId = attr(clearTag, "id") ?? "";
  const countId =
    /<div class="[^"]*result-count[^"]*">[\s\S]*?<span id="([^"]+)"/.exec(block)?.[1] ?? "";
  const tableId = new RegExp(`<table[^>]*class="${p}-price-table"[^>]*>`).exec(block)?.[0];
  const tableIdVal = tableId ? attr(tableId, "id") ?? "" : "";
  const tbodyTag = /<tbody[^>]*>/.exec(block)?.[0] ?? "";
  const tbodyId = attr(tbodyTag, "id") ?? "";
  const wrapperTag = new RegExp(`<div class="${p}-price-wrapper"[^>]*>`).exec(block)?.[0] ?? "";
  const wrapperId = attr(wrapperTag, "id");

  // no-results
  const noResTag = new RegExp(`<div class="${p}-no-results"[^>]*>`).exec(block)?.[0] ?? "";
  const noResId = attr(noResTag, "id") ?? "";
  const noResHidden: "hidden" | "style" = /\bhidden\b/.test(noResTag) ? "hidden" : "style";
  const noResHtml =
    new RegExp(`<div class="${p}-no-results"[^>]*>([\\s\\S]*?)</div>`).exec(block)?.[1]?.trim() ?? "";

  const naming: "camel" | "kebab" = searchId.includes("-") ? "kebab" : "camel";

  // ---- クラス（hidden / active） ----
  const activeM = new RegExp(`class="${p}-filter-chip (${p}-[\\w-]+)"[^>]*${p}-filter-series="all"`).exec(
    block,
  );
  const active = activeM?.[1] ?? `${p}-active`;
  const hiddenM = new RegExp(`tbody tr\\.(${p}-[\\w-]+)\\s*\\{\\s*display:\\s*none`).exec(block);
  const hidden = hiddenM?.[1] ?? `${p}-hidden`;

  // ---- minWidth ----
  const mwM = new RegExp(`\\.${p}-price-table\\s*\\{[^}]*?min-width:\\s*(\\d+)px`).exec(block);
  const minWidth = mwM ? Number(mwM[1]) : 0;

  // ---- フィルタチップ（ボタン側 data-{p}-filter-series） ----
  const filterGroup = new RegExp(`<div class="${p}-filter-group"[^>]*>`).exec(block)?.[0] ?? "";
  const hasFilterGroup = filterGroup !== "";
  const filterAria = filterGroup ? attr(filterGroup, "aria-label") ?? "" : "";
  const filterLabel =
    new RegExp(`<div class="${p}-filter-label">([\\s\\S]*?)</div>`).exec(block)?.[1]?.trim() ?? "";
  const series: string[] = [];
  {
    const re = new RegExp(`data-${p}-filter-series="([^"]*)"`, "g");
    let m: RegExpExecArray | null;
    while ((m = re.exec(block)) !== null) if (m[1] !== "all") series.push(m[1]);
  }

  // ---- ガワ（実測文字列） ----
  const headerComment = /<!--\s*=+[\s\S]*?=+\s*-->/.exec(block)?.[0] ?? "";
  const jsonLd = /<script type="application\/ld\+json">[\s\S]*?<\/script>/.exec(block)?.[0] ?? "";
  const introHtml =
    new RegExp(`<div class="${p}-intro">([\\s\\S]*?)</div>`).exec(block)?.[1]?.trim() ?? "";
  const tableNoteHtml =
    new RegExp(`<div class="${p}-table-note">([\\s\\S]*?)</div>`).exec(block)?.[1]?.trim() ?? "";
  const styleHtml = /<style>[\s\S]*?<\/style>/.exec(block)?.[0] ?? "";
  // 末尾の挙動スクリプト（type付き=JSON-LD は除外）
  const scriptHtml =
    [...block.matchAll(/<script(?![^>]*type=)[^>]*>[\s\S]*?<\/script>/g)].pop()?.[0] ?? "";
  const askHrefVal =
    /<a href="([^"]*)"[^>]*class="[^"]*ask-btn/.exec(block)?.[1] ?? "https://lin.ee/8yOXuPJ";

  // ---- thead 列 ----
  const theadInner = /<thead>([\s\S]*?)<\/thead>/.exec(block)?.[1] ?? "";
  const thTags = [...theadInner.matchAll(/<th\b([^>]*)>([\s\S]*?)<\/th>/g)];

  // ---- tbody 行 ----
  const tbodyInner = /<tbody[^>]*>([\s\S]*?)<\/tbody>/.exec(block)?.[1] ?? "";
  const trBlocks = [...tbodyInner.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/g)];

  // 先頭行の td から各列の cellクラス接尾辞（＝役割）を確定する
  const firstRowTds = trBlocks.length
    ? [...trBlocks[0][2].matchAll(/<td\b([^>]*)>[\s\S]*?<\/td>/g)].map((m) => m[1])
    : [];
  const cellSuffixes = firstRowTds.map((tdAttrs) => {
    const c = attr(`<x${tdAttrs}>`, "class") ?? "";
    // "lambo-cell-price-stage1" → "cell-price-stage1"
    const first = c.split(/\s+/)[0] ?? "";
    return first.startsWith(`${p}-`) ? first.slice(p.length + 1) : first;
  });

  const columns: ParsedColumn[] = thTags.map((m, index) => {
    const thAttrs = m[1];
    const headerHtml = m[2].trim();
    const thClass = attr(`<x${thAttrs}>`, "class") ?? "";
    const colPrice = thClass.split(/\s+/).includes(`${p}-col-price`);
    const sortable = thClass.split(/\s+/).includes(`${p}-sortable`);
    const cellClassSuffix = cellSuffixes[index] ?? "cell-text";
    const role = roleOf(cellClassSuffix);
    const sortKey =
      role === "car" || role === "grade" || role === "engine" || role === "maker"
        ? role
        : `c${index}`;
    return {
      index,
      sortKey,
      cellClassSuffix,
      role,
      headerHtml,
      colPrice,
      sortable,
      askLabel: null,
      titleLabel: null,
    };
  });

  const hasGradeColumn = columns.some((c) => c.role === "grade");
  const gradeColIndex = columns.findIndex((c) => c.role === "grade");

  // ---- 各行を解析（ついでに列の askLabel/titleLabel を実測） ----
  const rows: ParsedRow[] = trBlocks.map((m) => {
    const trAttrs = m[1];
    const rowHtml = m[2];
    const series = attr(`<x${trAttrs}>`, `data-${p}-series`) ?? "";
    const searchText = attr(`<x${trAttrs}>`, `data-${p}-search`) ?? "";
    const tds = [...rowHtml.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/g)].map((x) => x[1]);

    // grade セルから gradeClean / hasStar
    let gradeClean = "";
    let hasStar = false;
    if (gradeColIndex >= 0 && tds[gradeColIndex] !== undefined) {
      const g = tds[gradeColIndex];
      hasStar = /cell-note/.test(g);
      gradeClean = stripTags(g.replace(/<span class="[^"]*cell-note[^"]*"[\s\S]*?<\/span>/g, "")).trim();
    }

    // 行の ask-btn から data-car（生値）
    let askCar: string | null = null;
    const firstAsk = /<a[^>]*class="[^"]*ask-btn[^"]*"[^>]*>/.exec(rowHtml);
    if (firstAsk) askCar = attr(firstAsk[0], "data-car") ?? "";

    const cells: CellCell[] = columns.map((col, i) => {
      const inner = tds[i] ?? "";
      // ask-btn を含む列は data-label / title を実測（列に一度だけ記録）
      if (/class="[^"]*ask-btn/.test(inner)) {
        const aTag = /<a[^>]*class="[^"]*ask-btn[^"]*"[^>]*>/.exec(inner)?.[0] ?? "";
        if (col.askLabel === null) col.askLabel = attr(aTag, "data-label") ?? "";
        if (col.titleLabel === null) {
          const title = attr(aTag, "title") ?? "";
          col.titleLabel = /【([\s\S]*?)見積希望】/.exec(title)?.[1] ?? "";
        }
      }
      if (col.role === "price" || col.role === "tcu" || col.role === "labor") {
        return { role: "value", value: parseCellValue(inner) };
      }
      return { role: "verbatim", innerHtml: inner.trim() };
    });

    return { series, searchText, askCar, gradeClean, hasStar, cells };
  });

  const layout: BrandLayout = {
    namespacePrefix: p,
    naming,
    ids: {
      search: searchId,
      clear: clearId,
      count: countId,
      noResults: noResId,
      tbody: tbodyId,
      table: tableIdVal,
      wrapper: wrapperId,
    },
    classes: { hidden, active },
    minWidth,
    series,
    hasFilterGroup,
    filterLabel,
    filterAria,
    placeholder,
    askHref: askHrefVal,
    hasGradeColumn,
    headerComment,
    jsonLd,
    introHtml,
    tableNoteHtml,
    styleHtml,
    scriptHtml,
    noResultsHtml: noResHtml,
    noResultsHidden: noResHidden,
    note: `pageId=${opts.pageId} block=${opts.blockIndex} prefix=${p}`,
  };

  return { pageId: opts.pageId, blockIndex: opts.blockIndex, layout, columns, rows };
}

// ── パイロット定義 ───────────────────────────────────────────────
export const PILOTS: { id: string; pageId: number; blockIndex: number; prefix: string }[] = [
  { id: "lambo", pageId: 9668, blockIndex: 0, prefix: "lambo" },
  { id: "ferrari", pageId: 9616, blockIndex: 0, prefix: "ferrari" },
  { id: "mbd", pageId: 9679, blockIndex: 2, prefix: "mbd" },
  { id: "others", pageId: 9691, blockIndex: 0, prefix: "others" },
];

export function loadFixture(pageId: number): string {
  return readFileSync(join(ROOT, "prisma", "data", "wp-live", `${pageId}.html`), "utf-8");
}

export function parsePilot(id: string): ParsedBlock {
  const pil = PILOTS.find((x) => x.id === id);
  if (!pil) throw new Error(`unknown pilot: ${id}`);
  return parseWpBlock(loadFixture(pil.pageId), pil);
}

// ── CLI: 要約表示 ────────────────────────────────────────────────
const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const only = process.argv[2];
  for (const pil of PILOTS) {
    if (only && only !== pil.id) continue;
    const pb = parsePilot(pil.id);
    void decodeEntitiesForText; // 予約
    console.log(`\n=== ${pil.id} (page ${pil.pageId} block ${pil.blockIndex}) ===`);
    console.log(
      `naming=${pb.layout.naming} ids=${JSON.stringify(pb.layout.ids)} classes=${JSON.stringify(pb.layout.classes)} minWidth=${pb.layout.minWidth}`,
    );
    console.log(`series(${pb.layout.series.length})=${pb.layout.series.join(",")}`);
    console.log(
      `columns(${pb.columns.length}): ` +
        pb.columns.map((c) => `${c.sortKey}:${c.role}(${c.cellClassSuffix})`).join(" | "),
    );
    console.log(`rows=${pb.rows.length}`);
  }
}
