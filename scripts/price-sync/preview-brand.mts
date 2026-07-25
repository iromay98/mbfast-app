/*
 * 指定ブランドの公開HTMLを生成してファイルに書き出す（レビュー・プレビュー用）。
 * 使い方: set -a && . ./.env && set +a && tsx scripts/price-sync/preview-brand.mts <brandId...> [--out <dir>]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";
import { generatePriceTableHtml } from "../../src/lib/prices/generate-html";
import { toColumns, toPrices, toRemote, type BrandRow, type VehicleRow } from "../../src/lib/prices/types";

const args = process.argv.slice(2);
const outIdx = args.indexOf("--out");
const outDir = outIdx >= 0 ? args[outIdx + 1] : ".verify-out";
const ids = args.filter((a, i) => a !== "--out" && i !== outIdx + 1);
if (ids.length === 0) throw new Error("brandId を指定してください");
mkdirSync(outDir, { recursive: true });

const c = new Client({ connectionString: process.env.DATABASE_URL!.replace(/\?schema=public$/, "") });
await c.connect();
for (const id of ids) {
  const b = (await c.query(`SELECT * FROM "PriceBrand" WHERE id=$1`, [id])).rows[0];
  if (!b) throw new Error(`ブランドが見つかりません: ${id}`);
  const brand: BrandRow = {
    id: b.id, displayName: b.displayName, slug: b.slug, namespacePrefix: b.namespacePrefix,
    seriesGroups: b.seriesGroups, columns: toColumns(b.columns), intro: b.intro ?? "",
    jsonLdDescription: b.jsonLdDescription ?? "", wordPressPageId: b.wordPressPageId, vehicleCount: 0,
  };
  const vs = (await c.query(`SELECT * FROM "PriceVehicle" WHERE "brandId"=$1 AND market='JP' ORDER BY "displayOrder"`, [id])).rows;
  const vehicles: VehicleRow[] = vs.map((v) => ({
    id: v.id, seriesGroup: v.seriesGroup, carName: v.carName, grade: v.grade, engine: v.engine,
    engineFamily: v.engineFamily, ecuType: v.ecuType, stockOutput: v.stockOutput, stage1Gain: v.stage1Gain,
    prices: toPrices(v.prices), labor: v.labor, shops: v.shops, remote: toRemote(v.remote),
    notes: v.notes, displayOrder: v.displayOrder,
  }));
  const html = generatePriceTableHtml(brand, vehicles);
  // WP固定ページ相当の骨組みで包む（単体プレビュー用）
  const page = `<!doctype html><html lang="ja"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><body style="background:#f5f5f5;padding:16px;margin:0">\n${html}\n</body></html>`;
  writeFileSync(join(outDir, `${id}.html`), page);
  console.log(`${id.padEnd(12)} ${String(vehicles.length).padStart(4)} rows  ${(html.length / 1024).toFixed(0).padStart(4)} KB → ${join(outDir, `${id}.html`)}`);
}
await c.end();
