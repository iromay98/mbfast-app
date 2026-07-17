/*
 * import-price-html.mts の取りこぼし2点を reference HTML から復元する:
 *   1. remote.atOne — バッジ title="AT One" を見逃していた
 *   2. labor のダッシュ表示 — LINEボタン(null)と「—」の区別が消えていた → ダッシュは労賃 "—" として保存
 * ローカルDBを直接更新し、本番用SQL prisma/data/prices-fix.sql（説明文の補正込み）も書き出す。
 *
 * 使い方: DATABASE_URL=... tsx scripts/backfill-price-details.mts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BRANDS = [
  { id: "bmw", file: "bmw_price_table.html", ns: "", searchAttr: "data-search" },
  { id: "mercedes_gasoline", file: "mercedes_price_table.html", ns: "", searchAttr: "data-search" },
  { id: "mercedes_diesel", file: "mercedes_diesel_price_table.html", ns: "mbd-", searchAttr: "data-mbd-search" },
  { id: "audi", file: "audi_price_table.html", ns: "audi-", searchAttr: "data-audi-search" },
  { id: "lamborghini", file: "lamborghini_price_table.html", ns: "", searchAttr: "data-search" },
];

const url =
  process.env.DATABASE_URL ??
  (readFileSync(join(root, ".env"), "utf8").match(/DATABASE_URL="([^"]+)"/) || [])[1];
if (!url) throw new Error("DATABASE_URL が読めません");
const c = new Client({ connectionString: url.replace(/\?schema=public$/, "") });
await c.connect();

const sqlOut: string[] = [
  "-- 価格表データの補正（scripts/backfill-price-details.mts が生成）。一度だけ流す。",
  "BEGIN;",
];

// 説明文の補正も同じSQLに含める
for (const b of BRANDS) {
  const html = readFileSync(join(root, "prisma", "data", "reference", b.file), "utf8");
  const m = /"description":\s*"([^"]*)"/.exec(html);
  if (m) {
    sqlOut.push(
      `UPDATE "PriceBrand" SET "jsonLdDescription"='${m[1].replace(/'/g, "''")}', "updatedAt"=now() WHERE id='${b.id}';`,
    );
  }
}

let laborFixed = 0;
let atOneFixed = 0;
for (const b of BRANDS) {
  const html = readFileSync(join(root, "prisma", "data", "reference", b.file), "utf8");
  const rowRe = new RegExp(`<tr [^>]*${b.searchAttr}="[^"]*"[^>]*>([\\s\\S]*?)</tr>`, "g");
  let i = -1;
  for (const m of html.matchAll(rowRe)) {
    i++;
    const body = m[1];
    const laborM = new RegExp(`<td class="${b.ns}cell-labor"[^>]*>([\\s\\S]*?)</td>`).exec(body);
    const laborIsDash = laborM ? /class="[a-z-]*muted"/.test(laborM[1]) : false;
    const remoteM = new RegExp(`<td class="${b.ns}cell-remote"[^>]*>([\\s\\S]*?)</td>`).exec(body);
    const hasAtOne = remoteM ? /title="AT One"/.test(remoteM[1]) : false;

    if (laborIsDash) {
      await c.query(
        `UPDATE "PriceVehicle" SET labor='—', "updatedAt"=now() WHERE "brandId"=$1 AND "displayOrder"=$2 AND labor IS NULL`,
        [b.id, i],
      );
      sqlOut.push(
        `UPDATE "PriceVehicle" SET labor='—', "updatedAt"=now() WHERE "brandId"='${b.id}' AND "displayOrder"=${i} AND labor IS NULL;`,
      );
      laborFixed++;
    }
    if (hasAtOne) {
      await c.query(
        `UPDATE "PriceVehicle" SET remote = remote::jsonb || '{"atOne":true}'::jsonb, "updatedAt"=now() WHERE "brandId"=$1 AND "displayOrder"=$2`,
        [b.id, i],
      );
      sqlOut.push(
        `UPDATE "PriceVehicle" SET remote = remote::jsonb || '{"atOne":true}'::jsonb, "updatedAt"=now() WHERE "brandId"='${b.id}' AND "displayOrder"=${i};`,
      );
      atOneFixed++;
    }
  }
  console.log(`${b.id.padEnd(20)} rows=${i + 1}`);
}

sqlOut.push("COMMIT;");
writeFileSync(join(root, "prisma", "data", "prices-fix.sql"), sqlOut.join("\n") + "\n");
await c.end();
console.log(`\nlabor“—”=${laborFixed}件 / atOne=${atOneFixed}件 を補正。本番用: prisma/data/prices-fix.sql`);
