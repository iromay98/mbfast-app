/*
 * 列順ルール検証（同期前の必須チェック・GETのみ書き込み無し）:
 * Airtable由来15ブランドについて、生成HTMLの列順（thead）がライブWPページの列順と
 * 一致するかを突き合わせる。
 *
 * 背景: 工賃列は「価格列の直後」が正（applyColumnOrderRule）。ライブ側は10ブランドを
 * 手動で並び替え済みのため、このチェックが全ブランド一致になってから同期すること
 * （不一致のまま同期すると手動修正が巻き戻る）。
 *
 * 使い方: set -a && . ./.env && set +a && tsx scripts/price-sync/verify-column-order.mts
 */
import { Client } from "pg";
import { generatePriceTableHtml } from "../../src/lib/prices/generate-html";
import { parseWpHtmlBlocks, wrapperMarker } from "../../src/lib/prices/wp-blocks";
import { toColumns, toPrices, toRemote, type BrandRow, type VehicleRow } from "../../src/lib/prices/types";

const BASE = process.env.WP_BASE_URL ?? "https://mbfasttuning.com";
const auth = `Basic ${Buffer.from(`${process.env.WP_USER}:${process.env.WP_APP_PASSWORD}`).toString("base64")}`;

// ゴールデン4ブランド（既存HTML抽出・列順ルール対象外）
const GOLDEN = new Set(["bmw", "mercedes_gasoline", "mercedes_diesel", "audi", "lamborghini"]);

// thead の th テキスト列（タグ・空白除去）を取り出す
function theadSequence(html: string): string[] {
  const m = /<thead>([\s\S]*?)<\/thead>/.exec(html);
  if (!m) return [];
  return [...m[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((t) =>
    t[1].replace(/<[^>]+>/g, "").replace(/\s+/g, "").replace(/&amp;/g, "&"),
  );
}

const DB = process.env.DATABASE_URL!;
const c = new Client({ connectionString: DB.replace(/\?schema=public$/, "") });
await c.connect();

const bRes = await c.query(`SELECT * FROM "PriceBrand" WHERE "wordPressPageId" IS NOT NULL ORDER BY "displayOrder"`);
let allOk = true;
let checked = 0;

for (const b of bRes.rows) {
  if (GOLDEN.has(b.id)) continue;
  const brand: BrandRow = {
    id: b.id, displayName: b.displayName, slug: b.slug, namespacePrefix: b.namespacePrefix,
    seriesGroups: b.seriesGroups, columns: toColumns(b.columns), intro: b.intro ?? "",
    jsonLdDescription: b.jsonLdDescription ?? "", wordPressPageId: b.wordPressPageId, vehicleCount: 0,
  };
  const vRes = await c.query(
    `SELECT * FROM "PriceVehicle" WHERE "brandId"=$1 AND market='JP' ORDER BY "displayOrder"`,
    [b.id],
  );
  const vehicles: VehicleRow[] = vRes.rows.map((v) => ({
    id: v.id, seriesGroup: v.seriesGroup, carName: v.carName, grade: v.grade, engine: v.engine,
    engineFamily: v.engineFamily, ecuType: v.ecuType, stockOutput: v.stockOutput, stage1Gain: v.stage1Gain,
    prices: toPrices(v.prices), labor: v.labor, shops: v.shops, remote: toRemote(v.remote),
    notes: v.notes, displayOrder: v.displayOrder,
  }));
  const html = generatePriceTableHtml(brand, vehicles);
  const genSeq = theadSequence(html);

  const res = await fetch(`${BASE}/wp-json/wp/v2/pages/${b.wordPressPageId}?context=edit&_fields=id,slug,content.raw`, {
    headers: { Authorization: auth },
  });
  if (!res.ok) {
    console.log(`❌ ${b.id}: ページ${b.wordPressPageId} 取得失敗 HTTP ${res.status}`);
    allOk = false;
    continue;
  }
  const { content } = (await res.json()) as { content: { raw: string } };
  const blocks = parseWpHtmlBlocks(content.raw);
  const marker = wrapperMarker(html);
  const block = blocks.find((bl) => bl.inner.includes(marker));
  if (!block) {
    console.log(`❌ ${b.id}: ブロック未検出 (marker=${marker})`);
    allOk = false;
    continue;
  }
  const liveSeq = theadSequence(block.inner);
  const same = genSeq.length === liveSeq.length && genSeq.every((x, i) => x === liveSeq[i]);
  checked++;
  if (same) {
    console.log(`✅ 列順一致 ${b.id}: ${genSeq.join(" | ")}`);
  } else {
    allOk = false;
    console.log(`❌ 列順不一致 ${b.id}`);
    console.log(`   live: ${liveSeq.join(" | ")}`);
    console.log(`   gen : ${genSeq.join(" | ")}`);
  }
}
await c.end();
console.log(
  allOk
    ? `\n✅ ${checked}ブランド全て列順一致 — 同期してもライブの列順は維持されます`
    : "\n❌ 列順不一致あり — このまま同期するとライブの手動修正が巻き戻ります。修正してから同期してください",
);
process.exit(allOk ? 0 : 1);
