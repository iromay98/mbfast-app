/*
 * Step A: オフライン・ラウンドトリップ検証（npm run check:price-roundtrip）。
 *
 *   全27テーブル（wp-live 全ページ・複数ブロックはindexで分離）について:
 *     フィクスチャHTML → 該当ブロック抽出 → parseWpBlock → 生成エンジンで3領域を再生成
 *     → ライブHTMLの同じ3領域と「構造比較」（空白・属性順のみ許容）。
 *   さらに、保持した“ガワ”（<style>/<script>）と生成物の「契約」を機械検査する
 *   整合性アサート5本を各テーブルで実行し、合否に含める。
 *
 *   比較対象＝データを担う3領域（価格値・行数・列構成・クラス名・ID）:
 *     1) 検索/フィルタ操作部  2) thead  3) tbody
 *
 *   整合性アサート（ガワ↔生成の契約。JS/CSS は Step A' で生成予定・今は実測保持）:
 *     A1 CSS: 各列の cellクラスに対応するCSSルールが保持<style>内に在る
 *     A2 JS getElementById(...) の全IDが生成スケルトンに在る
 *     A3 JS querySelectorAll/getAttribute が参照するクラス/data属性が生成スケルトンに在る
 *     A4 保持JSに文字 & と < が無い（WP保存で &#038; 化しJS全滅する事故防止）
 *     A5 保持JSが node --check を通る（括弧過多等でスクリプト全体死を防止）
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverTables, loadFixture, parseWpBlock, extractBlock, PILOTS } from "./parse-wp.mts";
import { buildRegionsFromParsed } from "../../src/lib/prices/generated-template";
import type { ParsedBlock } from "../../src/lib/prices/generated-template";

// ── HTML 正規化（空白・属性順のみ吸収） ─────────────────────────
function normalizeTag(tag: string): string {
  const body = tag.replace(/^<\/?/, "").replace(/\/?>$/, "").trim();
  const close = /^<\//.test(tag) ? "/" : "";
  const nameM = /^([:\w-]+)/.exec(body);
  if (!nameM) return tag;
  const name = nameM[1];
  const rest = body.slice(name.length);
  const attrs: string[] = [];
  const re = /([:\w-]+)(?:\s*=\s*"([^"]*)")?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest)) !== null) {
    if (!m[1]) continue;
    attrs.push(m[2] !== undefined ? `${m[1]}="${m[2]}"` : m[1]);
  }
  attrs.sort();
  return `<${close}${name}${attrs.length ? " " + attrs.join(" ") : ""}>`;
}
function tokenize(html: string): string[] {
  const parts = html.split(/(<[^>]+>)/);
  const out: string[] = [];
  for (const part of parts) {
    if (part.startsWith("<") && part.endsWith(">")) out.push(normalizeTag(part));
    else {
      const t = part.replace(/\s+/g, " ").trim();
      if (t) out.push(t);
    }
  }
  return out;
}
function diffTokens(live: string[], gen: string[]): { equal: boolean; count: number; samples: string[] } {
  const samples: string[] = [];
  let count = 0;
  const n = Math.max(live.length, gen.length);
  for (let i = 0; i < n; i++) {
    if (live[i] !== gen[i]) {
      count++;
      if (samples.length < 6)
        samples.push(`     #${i} live:${live[i] ?? "(なし)"}  gen:${gen[i] ?? "(なし)"}`);
    }
  }
  return { equal: count === 0, count, samples };
}

// ── ライブブロックから3領域を抽出 ───────────────────────────────
function liveControls(block: string, p: string): string {
  const open = new RegExp(`<div class="${p}-controls">`).exec(block);
  const tableWrap = new RegExp(`<div class="${p}-table-wrap">`).exec(block);
  if (!open || !tableWrap) return "";
  return block.slice(open.index + open[0].length, tableWrap.index).replace(/\s*<\/div>\s*$/, "");
}
const liveThead = (block: string) => /<thead>([\s\S]*?)<\/thead>/.exec(block)?.[1] ?? "";
const liveTbody = (block: string) => /<tbody[^>]*>([\s\S]*?)<\/tbody>/.exec(block)?.[1] ?? "";
const countTr = (s: string) => [...s.matchAll(/<tr\b/g)].length;

// ── 検査用スケルトン（装飾なし・JS契約検査のため構造フックだけを組む） ──
// Step A' の本生成器ではないが、layout の ids/classes を使って“JSが掴む静的フック”
// （table-wrap / price-table / sortable th / フィルタボタン / tbody id / no-results id /
//  search/clear/count id / data属性）を全て並べ、A2/A3 の参照先照合に使う。
function assembleSkeleton(pb: ParsedBlock): string {
  const p = pb.layout.namespacePrefix;
  const g = buildRegionsFromParsed(pb);
  const wrapId = pb.layout.ids.wrapper ? ` id="${pb.layout.ids.wrapper}"` : "";
  const tableId = pb.layout.ids.table ? ` id="${pb.layout.ids.table}"` : "";
  const noResHidden = pb.layout.noResultsHidden === "hidden" ? " hidden" : ` style="display:none"`;
  return `<div class="${p}-price-wrapper"${wrapId}>
  <div class="${p}-controls">
${g.controls}
  </div>
  <div class="${p}-table-wrap">
    <table class="${p}-price-table"${tableId}>
      <thead>${g.thead}</thead>
      <tbody id="${pb.layout.ids.tbody}">
${g.tbody}
      </tbody>
    </table>
  </div>
  <div class="${p}-no-results" id="${pb.layout.ids.noResults}"${noResHidden}></div>
</div>`;
}

// ── JS 本体（<script>…</script> の中身） ────────────────────────
const jsBody = (pb: ParsedBlock) =>
  pb.layout.scriptHtml.replace(/^<script>/, "").replace(/<\/script>\s*$/, "");

// ══ 整合性アサート5本 ═════════════════════════════════════════════
type Assert = { ok: boolean; missing: string[] };

// A1: 各列の cellクラスに対応するCSSルールが保持<style>内に在る。
//  ・取込(実測)時点で在った列（suffix ∈ layout.columnKeys）＝緩い被覆判定でOK
//    （専用ルール、または price総称セレクタ、または内側クラス（badge-remote/muted等）が
//     全て定義済みなら「装飾あり」と見なす）。
//  ・生成時に新規追加された列（suffix ∉ layout.columnKeys）＝ `.{p}-{suffix}` 直接ルール必須
//    に厳格化（新列をCSS未定義のまま足す＝無装飾事故を前方互換で防ぐ）。差分ゼロの現状は不発火。
function assertColumnCss(pb: ParsedBlock): Assert {
  const p = pb.layout.namespacePrefix;
  const css = pb.layout.styleHtml;
  const known = new Set(pb.layout.columnKeys);
  const missing: string[] = [];
  for (const c of pb.columns) {
    const suf = c.cellClassSuffix;
    const exact = css.includes(`.${p}-${suf}`);
    if (!known.has(suf)) {
      // 新規列: 直接ルール必須
      if (!exact) missing.push(`${suf}(${c.sortKey}) [新規列・直接CSSルール必須]`);
      continue;
    }
    const priceGeneric =
      suf.startsWith("cell-price-") &&
      (css.includes(`[class^="${p}-cell-price-"]`) || css.includes(`.${p}-col-price`));
    // その列のセルが内側に持つクラスを実データから収集し、全て定義済みか
    const inner = new Set<string>();
    for (const row of pb.rows) {
      const cell = row.cells[c.index];
      if (cell && cell.role === "verbatim")
        for (const cm of cell.innerHtml.matchAll(/class="([^"]*)"/g))
          for (const tok of cm[1].split(/\s+/)) if (tok) inner.add(tok);
    }
    const innerCovered = inner.size > 0 && [...inner].every((tok) => css.includes(`.${tok}`));
    if (!(exact || priceGeneric || innerCovered)) missing.push(`${suf}(${c.sortKey})`);
  }
  return { ok: missing.length === 0, missing };
}

// A2: JS getElementById(...) の全IDが生成スケルトンに在る
function assertGetById(pb: ParsedBlock, skeleton: string): Assert {
  const js = jsBody(pb);
  const ids = [...js.matchAll(/getElementById\(\s*['"]([^'"]+)['"]\s*\)/g)].map((m) => m[1]);
  const missing = [...new Set(ids)].filter((id) => !skeleton.includes(`id="${id}"`));
  return { ok: missing.length === 0, missing };
}

// A3: JS querySelector(All)/getAttribute が参照するクラス/data属性が生成スケルトンに在る
// A3: JS querySelector(All)/getAttribute が参照するクラス/data属性が生成スケルトンに在る。
//  分岐は seriesChips 個数（layout.series 長・HTML実測）で行う:
//   ・チップ0個 → filter-series 参照は空NodeListで無害＝除外OK。
//   ・チップ1個以上 → filter-series をアサート必須。さらに tr側 data-{p}-series と
//     ボタン側 data-{p}-filter-series を **別々に** 生成HTMLへ突合（片方だけ見て通さない
//     ＝27ブランドで実際に取り違え事故があった箇所）。
function assertSelectors(pb: ParsedBlock, gen: { controls: string; tbody: string }, skeleton: string): Assert {
  const p = pb.layout.namespacePrefix;
  const js = jsBody(pb);
  const missing: string[] = [];
  const hasChips = pb.layout.series.length >= 1;
  const skip = (tok: string) => !hasChips && tok.includes("filter-series");

  // getAttribute('data-…') → スケルトンに data属性として在るか
  for (const m of js.matchAll(/getAttribute\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const a = m[1];
    if (a.startsWith("data-") && !skeleton.includes(`${a}=`) && !skip(a)) missing.push(`attr:${a}`);
  }
  // querySelector(All)('SEL') のクラス/属性トークン
  for (const m of js.matchAll(/querySelector(?:All)?\(\s*['"]([^'"]+)['"]\s*\)/g)) {
    const sel = m[1];
    for (const cm of sel.matchAll(/\.([\w-]+)/g))
      if (!skeleton.includes(`${cm[1]}`) && !skip(cm[1])) missing.push(`class:.${cm[1]} (in "${sel}")`);
    for (const am of sel.matchAll(/\[([\w-]+)(?:[~^$*|]?=)?[^\]]*\]/g))
      if (!skeleton.includes(`${am[1]}`) && !skip(am[1])) missing.push(`attr:[${am[1]}] (in "${sel}")`);
  }

  // チップ有り版面: tr側 series と ボタン側 filterSeries を別々に必須チェック
  if (hasChips) {
    if (!new RegExp(`<tr\\b[^>]*\\bdata-${p}-series="`).test(gen.tbody))
      missing.push(`tr側 data-${p}-series が生成tbodyに無い`);
    if (!new RegExp(`<button\\b[^>]*\\bdata-${p}-filter-series="`).test(gen.controls))
      missing.push(`ボタン側 data-${p}-filter-series が生成controlsに無い`);
  }
  return { ok: missing.length === 0, missing: [...new Set(missing)] };
}

// A4: 保持JSに文字 & と < が無い
function assertNoAmpLt(pb: ParsedBlock): Assert {
  const body = jsBody(pb).replace(/<\/script>/g, "");
  const missing: string[] = [];
  if (body.includes("&")) missing.push("裸の & がある（WP保存で &#038; 化）");
  if (/</.test(body)) missing.push("裸の < がある");
  return { ok: missing.length === 0, missing };
}

// A5: 保持JSが node --check を通る
function assertNodeCheck(pb: ParsedBlock, dir: string, id: string): Assert {
  const f = join(dir, `${id}.js`);
  writeFileSync(f, jsBody(pb));
  const r = spawnSync(process.execPath, ["--check", f], { encoding: "utf-8" });
  return { ok: r.status === 0, missing: r.status === 0 ? [] : [(r.stderr || "").trim().split("\n")[0]] };
}

// ── 実行 ─────────────────────────────────────────────────────────
const only = process.argv[2]; // "pilots" / brand id / 省略(=全27)
const pilotIds = new Set(PILOTS.map((p) => p.id));
let tables = discoverTables();
if (only === "pilots") tables = tables.filter((t) => pilotIds.has(t.id));
else if (only) tables = tables.filter((t) => t.id === only);

const tmp = mkdtempSync(join(tmpdir(), "roundtrip-"));
let anyFail = false;
const summary: string[] = [];

for (const t of tables) {
  const html = loadFixture(t.pageId);
  const block = extractBlock(html, t.blockIndex);
  const pb = parseWpBlock(html, t);
  const g = buildRegionsFromParsed(pb);
  const skeleton = assembleSkeleton(pb);

  const regions = [
    { name: "controls", live: liveControls(block, t.prefix), gen: g.controls },
    { name: "thead", live: liveThead(block), gen: g.thead },
    { name: "tbody", live: liveTbody(block), gen: g.tbody },
  ];
  const liveRows = countTr(liveTbody(block));
  const genRows = countTr(g.tbody);
  const regionResults = regions.map((r) => ({ name: r.name, d: diffTokens(tokenize(r.live), tokenize(r.gen)) }));
  const zeroDiff = regionResults.every((r) => r.d.equal) && liveRows === genRows;

  const asserts: { key: string; a: Assert }[] = [
    { key: "A1css", a: assertColumnCss(pb) },
    { key: "A2ids", a: assertGetById(pb, skeleton) },
    { key: "A3sel", a: assertSelectors(pb, g, skeleton) },
    { key: "A4amp", a: assertNoAmpLt(pb) },
    { key: "A5chk", a: assertNodeCheck(pb, tmp, `${t.id}_${t.blockIndex}`) },
  ];
  const assertsOk = asserts.every((x) => x.a.ok);
  const fail = !zeroDiff || !assertsOk;
  if (fail) anyFail = true;

  const tag = pilotIds.has(t.id) ? "★" : " ";
  const aFlags = asserts.map((x) => `${x.key.slice(0, 2)}${x.a.ok ? "✔" : "✗"}`).join(" ");
  summary.push(
    `${tag}${t.id.padEnd(10)} p${t.pageId} b${t.blockIndex}  行${String(liveRows).padStart(3)}/${String(genRows).padStart(3)} 列${String(pb.columns.length).padStart(2)} ${pb.layout.naming.padEnd(5)}  ${(zeroDiff ? "ゼロ差分" : "残差あり").padEnd(6)}  ${aFlags}`,
  );

  if (fail) {
    console.log(`\n──── ${t.id} (page ${t.pageId} block ${t.blockIndex}) 失敗詳細 ────`);
    if (liveRows !== genRows) console.log(`  行数不一致: 実測${liveRows} / 生成${genRows}`);
    for (const r of regionResults)
      if (!r.d.equal) {
        console.log(`  [${r.name}] 残差 ${r.d.count} 箇所:`);
        for (const s of r.d.samples) console.log(s);
      }
    for (const x of asserts) if (!x.a.ok) console.log(`  [${x.key}] NG: ${x.a.missing.join(" / ")}`);
  }
}

console.log(`\n════════ 全${tables.length}テーブル 一覧（★=パイロット / A1css A2ids A3sel A4amp A5chk） ════════`);
for (const s of summary) console.log(s);
console.log(`\n対象 ${tables.length} テーブル / 結果: ${anyFail ? "✗ 失敗あり" : "✔ 全ゼロ差分＋5アサート通過"}`);
process.exit(anyFail ? 1 : 0);
