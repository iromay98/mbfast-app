/*
 * Step A: オフライン・ラウンドトリップ検証（npm run check:price-roundtrip）。
 *
 *   各パイロットについて:
 *     フィクスチャHTML → 該当ブロック抽出 → parseWpBlock → 生成エンジンで3領域を再生成
 *     → ライブHTMLの同じ3領域と「構造比較」。
 *
 *   比較対象＝データを担う3領域（価格値・行数・列構成・クラス名・ID が全てここに出る）:
 *     1) 検索/フィルタ操作部（<div class="{p}-controls"> の中身）
 *     2) thead（列構成）
 *     3) tbody（全行・全セル）
 *   許容差分は「空白・属性順のみ」。比較は空白正規化＋属性ソートしたトークン列で行う。
 *
 *   <style>/<script>/導入文/注記/JSON-LD は版面固有の“ガワ”として parse が layout に実測
 *   保持しており、この検証では突き合わせ対象外（再構成しない）。捕捉できているかの
 *   非空チェックだけ行う。
 */

import { PILOTS, loadFixture, parseWpBlock, extractBlock } from "./parse-wp.mts";
import { buildRegionsFromParsed } from "../../src/lib/prices/generated-template";

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

/** タグ列＋テキストのトークン列に落とす（空白は畳む）。 */
function tokenize(html: string): string[] {
  const parts = html.split(/(<[^>]+>)/);
  const out: string[] = [];
  for (const part of parts) {
    if (part.startsWith("<") && part.endsWith(">")) {
      out.push(normalizeTag(part));
    } else {
      const t = part.replace(/\s+/g, " ").trim();
      if (t) out.push(t);
    }
  }
  return out;
}

function diffTokens(
  live: string[],
  gen: string[],
): { equal: boolean; count: number; samples: string[] } {
  const samples: string[] = [];
  let count = 0;
  const n = Math.max(live.length, gen.length);
  for (let i = 0; i < n; i++) {
    if (live[i] !== gen[i]) {
      count++;
      if (samples.length < 8) {
        samples.push(`   #${i}\n     live: ${live[i] ?? "(なし)"}\n     gen : ${gen[i] ?? "(なし)"}`);
      }
    }
  }
  return { equal: count === 0, count, samples };
}

// ── ライブブロックから3領域を抽出 ───────────────────────────────
function liveControls(block: string, p: string): string {
  const open = new RegExp(`<div class="${p}-controls">`).exec(block);
  const tableWrap = new RegExp(`<div class="${p}-table-wrap">`).exec(block);
  if (!open || !tableWrap) return "";
  let inner = block.slice(open.index + open[0].length, tableWrap.index);
  // controls を閉じる末尾の </div> を1つ落とす
  inner = inner.replace(/\s*<\/div>\s*$/, "");
  return inner;
}
function liveThead(block: string): string {
  return /<thead>([\s\S]*?)<\/thead>/.exec(block)?.[1] ?? "";
}
function liveTbody(block: string): string {
  return /<tbody[^>]*>([\s\S]*?)<\/tbody>/.exec(block)?.[1] ?? "";
}
function countTr(s: string): number {
  return [...s.matchAll(/<tr\b/g)].length;
}

// ── 実行 ─────────────────────────────────────────────────────────
const only = process.argv[2];
let anyFail = false;
const summary: string[] = [];

for (const pil of PILOTS) {
  if (only && only !== pil.id) continue;
  const html = loadFixture(pil.pageId);
  const block = extractBlock(html, pil.blockIndex);
  const pb = parseWpBlock(html, pil);
  const gen = buildRegionsFromParsed(pb);

  const regions: { name: string; live: string; gen: string }[] = [
    { name: "controls", live: liveControls(block, pil.prefix), gen: gen.controls },
    { name: "thead", live: liveThead(block), gen: gen.thead },
    { name: "tbody", live: liveTbody(block), gen: gen.tbody },
  ];

  const liveRows = countTr(liveTbody(block));
  const genRows = countTr(gen.tbody);

  console.log(`\n════════ ${pil.id} (page ${pil.pageId} block ${pil.blockIndex}, ${pb.layout.naming}) ════════`);
  console.log(`行数: 実測 ${liveRows} / 生成 ${genRows}  ${liveRows === genRows ? "✔一致" : "✗不一致"}`);
  console.log(`列数: ${pb.columns.length}  列順キー: ${pb.columns.map((c) => c.sortKey).join(",")}`);

  // ガワ捕捉の非空チェック
  const chrome = ["headerComment", "jsonLd", "introHtml", "styleHtml", "scriptHtml"] as const;
  const missing = chrome.filter((k) => !(pb.layout as Record<string, unknown>)[k]);
  console.log(`ガワ捕捉(style/script/intro/jsonld/comment): ${missing.length ? "欠落=" + missing.join(",") : "✔全取得（比較対象外・実測保持）"}`);

  let brandFail = false;
  for (const r of regions) {
    const d = diffTokens(tokenize(r.live), tokenize(r.gen));
    const status = d.equal ? "✔ゼロ差分" : `✗残差 ${d.count} 箇所`;
    console.log(`  [${r.name}] ${status}`);
    if (!d.equal) {
      brandFail = true;
      anyFail = true;
      for (const s of d.samples) console.log(s);
    }
  }
  if (liveRows !== genRows) {
    brandFail = true;
    anyFail = true;
  }
  summary.push(
    `${pil.id.padEnd(8)} 行 ${liveRows}/${genRows}  列 ${pb.columns.length}  ${
      brandFail ? "残差あり" : "全領域ゼロ差分"
    }`,
  );
}

console.log(`\n──────── まとめ ────────`);
for (const s of summary) console.log(s);
process.exit(anyFail ? 1 : 0);
