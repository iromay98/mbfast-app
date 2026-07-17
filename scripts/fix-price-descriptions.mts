/*
 * PriceBrand.jsonLdDescription を reference HTML の実物に合わせて修正する。
 * （import-price-html.mts の初期値が実物と食い違っていたための一度きりの補正）
 * ローカルDBを直接更新し、本番用の UPDATE 文も prisma/data/prices-fix-descriptions.sql に書き出す。
 *
 * 使い方: DATABASE_URL=... tsx scripts/fix-price-descriptions.mts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

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

const sqlOut: string[] = ["-- jsonLdDescription を公開HTML実物に合わせる補正（scripts/fix-price-descriptions.mts が生成）"];
for (const [id, file] of Object.entries(FILES)) {
  const html = readFileSync(join(root, "prisma", "data", "reference", file), "utf8");
  const m = /"description":\s*"([^"]*)"/.exec(html);
  if (!m) throw new Error(`${file}: JSON-LD description が見つかりません`);
  const desc = m[1];
  await c.query(`UPDATE "PriceBrand" SET "jsonLdDescription"=$1, "updatedAt"=now() WHERE id=$2`, [desc, id]);
  sqlOut.push(
    `UPDATE "PriceBrand" SET "jsonLdDescription"='${desc.replace(/'/g, "''")}', "updatedAt"=now() WHERE id='${id}';`,
  );
  console.log(`${id.padEnd(20)} ${desc.slice(0, 50)}…`);
}
writeFileSync(join(root, "prisma", "data", "prices-fix-descriptions.sql"), sqlOut.join("\n") + "\n");
await c.end();
console.log("\nローカルDB更新済み / 本番用: prisma/data/prices-fix-descriptions.sql");
