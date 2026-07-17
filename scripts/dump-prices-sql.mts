// ローカルDBの価格表（PriceBrand / PriceVehicle）を、本番へ流し込める .sql に書き出す。
// 使い方: node_modules/.bin/tsx scripts/dump-prices-sql.mts > prisma/data/prices-seed.sql
import { Client } from "pg";

const lit = (v: unknown): string => {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) return `'${v.toISOString()}'`;
  if (Array.isArray(v) || typeof v === "object") return `'${JSON.stringify(v).replace(/'/g, "''")}'`;
  return `'${String(v).replace(/'/g, "''")}'`;
};

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL がありません");

const c = new Client({ connectionString: url.replace(/\?schema=public$/, "") });
await c.connect();

const out: string[] = [
  "-- 価格表シード（scripts/dump-prices-sql.mts が生成）。空のときだけ流し込む想定。",
  "BEGIN;",
];

for (const table of ["PriceBrand", "PriceVehicle"]) {
  const { rows } = await c.query(`SELECT * FROM "${table}" ORDER BY "displayOrder" ASC`);
  const cols = rows.length ? Object.keys(rows[0]) : [];
  out.push(`\n-- ${table}: ${rows.length} 行`);
  for (const r of rows) {
    const colList = cols.map((k) => `"${k}"`).join(", ");
    const valList = cols.map((k) => lit(r[k])).join(", ");
    // 既存行があれば触らない（本番の編集を壊さないため）
    out.push(`INSERT INTO "${table}" (${colList}) VALUES (${valList}) ON CONFLICT ("id") DO NOTHING;`);
  }
}

out.push("\nCOMMIT;");
await c.end();
process.stdout.write(out.join("\n") + "\n");
