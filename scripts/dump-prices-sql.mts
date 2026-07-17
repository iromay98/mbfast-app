// ローカルDBの価格表（PriceBrand / PriceVehicle）を、本番へ流し込める .sql に書き出す。
// 使い方: node_modules/.bin/tsx scripts/dump-prices-sql.mts > prisma/data/prices-seed.sql
import { Client } from "pg";

// isArrayCol: text[] 等のPostgres配列列は {"a","b"} 形式、Json列は JSON文字列のまま。
const lit = (v: unknown, isArrayCol: boolean): string => {
  if (v === null || v === undefined) return "NULL";
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) return `'${v.toISOString()}'`;
  if (Array.isArray(v) && isArrayCol) {
    const items = v.map((x) => `"${String(x).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`);
    return `'${`{${items.join(",")}}`.replace(/'/g, "''")}'`;
  }
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
  // udt_name が "_" 始まり = Postgres配列列（例: _text）
  const meta = await c.query(
    `SELECT column_name, udt_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1`,
    [table],
  );
  const arrayCols = new Set(
    meta.rows.filter((m) => String(m.udt_name).startsWith("_")).map((m) => m.column_name as string),
  );

  const { rows } = await c.query(`SELECT * FROM "${table}" ORDER BY "displayOrder" ASC`);
  const cols = rows.length ? Object.keys(rows[0]) : [];
  out.push(`\n-- ${table}: ${rows.length} 行`);
  for (const r of rows) {
    const colList = cols.map((k) => `"${k}"`).join(", ");
    const valList = cols.map((k) => lit(r[k], arrayCols.has(k))).join(", ");
    // 既存行があれば触らない（本番の編集を壊さないため）
    out.push(`INSERT INTO "${table}" (${colList}) VALUES (${valList}) ON CONFLICT ("id") DO NOTHING;`);
  }
}

out.push("\nCOMMIT;");
await c.end();
process.stdout.write(out.join("\n") + "\n");
