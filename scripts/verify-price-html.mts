/*
 * ゴールデンテスト: DBから生成したHTMLが prisma/data/reference/*.html と
 * 完全一致（バイト単位）することを検証する。
 *
 * 使い方: tsx scripts/verify-price-html.mts   （.env の DATABASE_URL を使用）
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";
import { generatePriceTableHtml } from "../src/lib/prices/generate-html";
import { toColumns, toPrices, toRemote, type BrandRow, type VehicleRow } from "../src/lib/prices/types";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILES: Record<string, string> = {
  bmw: "bmw_price_table.html",
  mercedes_gasoline: "mercedes_price_table.html",
  mercedes_diesel: "mercedes_diesel_price_table.html",
  audi: "audi_price_table.html",
  lamborghini: "lamborghini_price_table.html",
};

const url =
  process.env.DATABASE_URL ??
  (readFileSync(join(root, ".env"), "utf8").match(/DATABASE_URL="([^"]+)"/) || [])[1];
if (!url) throw new Error("DATABASE_URL が読めません");

const c = new Client({ connectionString: url.replace(/\?schema=public$/, "") });
await c.connect();

let allOk = true;
for (const [brandId, file] of Object.entries(FILES)) {
  const bRes = await c.query(`SELECT * FROM "PriceBrand" WHERE id=$1`, [brandId]);
  if (bRes.rows.length === 0) {
    console.log(`${brandId}: DBに無い — スキップ`);
    continue;
  }
  const b = bRes.rows[0];
  const brand: BrandRow = {
    id: b.id,
    displayName: b.displayName,
    slug: b.slug,
    namespacePrefix: b.namespacePrefix,
    seriesGroups: b.seriesGroups,
    columns: toColumns(b.columns),
    intro: b.intro ?? "",
    jsonLdDescription: b.jsonLdDescription ?? "",
    wordPressPageId: b.wordPressPageId,
    vehicleCount: 0,
  };
  const vRes = await c.query(`SELECT * FROM "PriceVehicle" WHERE "brandId"=$1 ORDER BY "displayOrder" ASC`, [brandId]);
  const vehicles: VehicleRow[] = vRes.rows.map((v) => ({
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
  }));

  const expected = readFileSync(join(root, "prisma", "data", "reference", file), "utf8");
  const actual = generatePriceTableHtml(brand, vehicles);

  if (actual === expected) {
    console.log(`✅ ${brandId.padEnd(18)} 完全一致 (${actual.length} bytes / ${vehicles.length} rows)`);
    continue;
  }

  allOk = false;
  // 最初の差分行を表示
  const eLines = expected.split("\n");
  const aLines = actual.split("\n");
  let diffCount = 0;
  for (let i = 0; i < Math.max(eLines.length, aLines.length) && diffCount < 3; i++) {
    if (eLines[i] !== aLines[i]) {
      diffCount++;
      console.log(`❌ ${brandId} L${i + 1}:`);
      console.log(`   期待: ${(eLines[i] ?? "(無し)").slice(0, 200)}`);
      console.log(`   生成: ${(aLines[i] ?? "(無し)").slice(0, 200)}`);
    }
  }
  const outDir = join(root, ".verify-out");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, file), actual);
  console.log(`   → 生成結果: .verify-out/${file}（diff で全差分を確認可能）`);
}

await c.end();
process.exit(allOk ? 0 : 1);
