/*
 * Step C 検証: ライブWPページ（GETのみ・書き込み無し）に対して同期エンジンのブロック特定＋
 * 差し替えロジックを通し、既存4ページで「全ブロック検出・差分ゼロ」を確認する。
 *
 * 使い方: set -a && . ./.env && set +a && tsx scripts/price-sync/dryrun-live.mts
 */
import { Client } from "pg";
import { generatePriceTableHtml } from "../../src/lib/prices/generate-html";
import { normalizeEntities, parseWpHtmlBlocks, wrapperMarker } from "../../src/lib/prices/wp-blocks";
import { toColumns, toPrices, toRemote, type BrandRow, type VehicleRow } from "../../src/lib/prices/types";

const BASE = process.env.WP_BASE_URL ?? "https://mbfasttuning.com";
const auth = `Basic ${Buffer.from(`${process.env.WP_USER}:${process.env.WP_APP_PASSWORD}`).toString("base64")}`;

const DB = process.env.DATABASE_URL!;
const c = new Client({ connectionString: DB.replace(/\?schema=public$/, "") });
await c.connect();

const PAGES = [9614, 9679, 9605, 9668];
let allOk = true;

for (const pageId of PAGES) {
  const bRes = await c.query(`SELECT * FROM "PriceBrand" WHERE "wordPressPageId"=$1 ORDER BY "displayOrder"`, [pageId]);
  const res = await fetch(`${BASE}/wp-json/wp/v2/pages/${pageId}?context=edit&_fields=id,slug,content.raw`, {
    headers: { Authorization: auth },
  });
  if (!res.ok) throw new Error(`page ${pageId}: HTTP ${res.status}`);
  const { content, slug } = (await res.json()) as { slug: string; content: { raw: string } };
  const blocks = parseWpHtmlBlocks(content.raw);

  for (const b of bRes.rows) {
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
    const marker = wrapperMarker(html);
    const block = blocks.find((bl) => bl.inner.includes(marker));
    if (!block) {
      console.log(`❌ ${slug}(${pageId}) ${b.id}: ブロック未検出 (marker=${marker})`);
      allOk = false;
      continue;
    }
    const lead = /^\s*/.exec(block.inner)?.[0] ?? "";
    const trail = /\s*$/.exec(block.inner)?.[0] ?? "";
    const newInner = lead + html.trim() + (trail || "\n");
    const changed = normalizeEntities(newInner) !== normalizeEntities(block.inner);
    console.log(
      `${changed ? "🔶 差分あり" : "✅ 差分ゼロ"} ${slug}(${pageId}) ${b.id} — ブロック検出OK (${block.inner.length} bytes)`,
    );
    if (changed) {
      allOk = false;
      const a = normalizeEntities(block.inner).split("\n");
      const n = normalizeEntities(newInner).split("\n");
      for (let i = 0, shown = 0; i < Math.max(a.length, n.length) && shown < 2; i++) {
        if (a[i] !== n[i]) {
          shown++;
          console.log(`   L${i + 1} live: ${(a[i] ?? "").slice(0, 120)}`);
          console.log(`   L${i + 1} gen : ${(n[i] ?? "").slice(0, 120)}`);
        }
      }
    }
  }
}
await c.end();
console.log(allOk ? "\n✅ 全ページ: ブロック特定＋差し替えロジック正常（ライブと差分ゼロ）" : "\n❌ 差分または未検出あり");
process.exit(allOk ? 0 : 1);
