/*
 * 元の公開HTML（prisma/data/reference/）から tbody の外側をテンプレートとして抽出し、
 * src/lib/prices/templates.ts を生成する。
 * 動的な箇所は {{INTRO}} / {{JSONLD_DESCRIPTION}} / {{FILTER_CHIPS}} / {{TOTAL}} に置換する。
 *
 * 使い方: tsx scripts/extract-price-templates.mts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const refDir = join(root, "prisma", "data", "reference");

const BRANDS = [
  { id: "bmw", file: "bmw_price_table.html", prefix: "bmw-" },
  { id: "mercedes_gasoline", file: "mercedes_price_table.html", prefix: "mb-" },
  { id: "mercedes_diesel", file: "mercedes_diesel_price_table.html", prefix: "mb-" }, // ライブ改修でmbd-→mb-系に統一
  { id: "audi", file: "audi_price_table.html", prefix: "audi-" },
  { id: "lamborghini", file: "lamborghini_price_table.html", prefix: "lambo-" },
];

type Tpl = { head: string; chip: string; foot: string };
const out: Record<string, Tpl> = {};

for (const b of BRANDS) {
  const html = readFileSync(join(refDir, b.file), "utf8");

  // tbody で3分割
  const openM = /^([ \t]*<tbody id="[^"]*">)\r?\n/m.exec(html);
  const closeM = /^([ \t]*<\/tbody>)/m.exec(html);
  if (!openM || !closeM) throw new Error(`${b.file}: tbody が見つかりません`);
  let head = html.slice(0, openM.index + openM[0].length);
  const foot = html.slice(closeM.index);

  // フィルタチップ: 「all」以外のチップ行のかたまり → {{FILTER_CHIPS}}（1行）
  // 1本目の非allチップからフォーマットを覚える
  const chipRe = /^[ \t]*<button type="button" class="[^"]*filter-chip"[^>]*data-[a-z-]*filter-series="(?!all")([^"]*)"[^>]*>[^<]*<\/button>[ \t]*$/gm;
  const chips = [...head.matchAll(chipRe)];
  if (chips.length === 0) throw new Error(`${b.file}: フィルタチップが見つかりません`);
  const first = chips[0];
  const series0 = first[1];
  // 値とラベルをトークン化（同一文字列なので単純置換でよい）
  const chipTpl = first[0]
    .replace(`data-filter-series="${series0}"`, `data-filter-series="{{S}}"`)
    .replace(`data-audi-filter-series="${series0}"`, `data-audi-filter-series="{{S}}"`)
    .replace(`data-mbd-filter-series="${series0}"`, `data-mbd-filter-series="{{S}}"`)
    .replace(`>${series0}</button>`, `>{{S}}</button>`);
  const blockStart = first.index!;
  const last = chips[chips.length - 1];
  const blockEnd = last.index! + last[0].length;
  head = head.slice(0, blockStart) + "{{FILTER_CHIPS}}" + head.slice(blockEnd);

  // 件数: <span id="xxResultCount">N</span> / N 件表示中
  head = head.replace(
    /(<span id="[A-Za-z]*ResultCount">)\d+(<\/span>\s*\/\s*)\d+( 件表示中)/,
    "$1{{TOTAL}}$2{{TOTAL}}$3",
  );
  if (!head.includes("{{TOTAL}}")) throw new Error(`${b.file}: 件数表示が見つかりません`);

  // 導入文: <div class="(prefix)intro"><p>…</p>
  const introRe = new RegExp(`(<div class="${b.prefix}intro">\\s*<p>)([\\s\\S]*?)(</p>)`);
  if (!introRe.test(head)) throw new Error(`${b.file}: intro が見つかりません`);
  head = head.replace(introRe, `$1{{INTRO}}$3`);

  // JSON-LD description
  const descRe = /("description":\s*")([^"]*)(")/;
  if (!descRe.test(head)) throw new Error(`${b.file}: JSON-LD description が見つかりません`);
  head = head.replace(descRe, `$1{{JSONLD_DESCRIPTION}}$3`);

  out[b.id] = { head, chip: chipTpl, foot };
}

const ts = `// このファイルは scripts/extract-price-templates.mts が生成する。手で編集しない。
// 元データ: prisma/data/reference/*.html（公開中の価格表HTML）
// プレースホルダ: {{INTRO}} {{JSONLD_DESCRIPTION}} {{FILTER_CHIPS}} {{TOTAL}}（chip 内は {{S}}）

export type PriceHtmlTemplate = { head: string; chip: string; foot: string };

export const PRICE_HTML_TEMPLATES: Record<string, PriceHtmlTemplate> = ${JSON.stringify(out, null, 2)};
`;
writeFileSync(join(root, "src", "lib", "prices", "templates.ts"), ts);
for (const [id, t] of Object.entries(out)) {
  console.log(`${id.padEnd(20)} head=${t.head.length}B foot=${t.foot.length}B chip=${JSON.stringify(t.chip.trim().slice(0, 60))}...`);
}
