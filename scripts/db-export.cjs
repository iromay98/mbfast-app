// ローカルDBを論理エクスポート（pg_dump代替）。列の型情報も保存して、本番で正しく復元する。
// 使い方: node scripts/db-export.cjs /tmp/mbfast-data.json   （要 DATABASE_URL）
const { Client } = require("pg");
const fs = require("fs");

(async () => {
  const out = process.argv[2] || "mbfast-data.json";
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const t = await c.query(
    `SELECT tablename FROM pg_tables
     WHERE schemaname='public' AND tablename <> '_prisma_migrations'
     ORDER BY tablename`,
  );

  const result = { tables: [] };
  for (const { tablename } of t.rows) {
    const cols = await c.query(
      `SELECT column_name, data_type, udt_name
       FROM information_schema.columns
       WHERE table_schema='public' AND table_name=$1
       ORDER BY ordinal_position`,
      [tablename],
    );
    const rows = await c.query(`SELECT * FROM "${tablename}"`);
    result.tables.push({
      table: tablename,
      columns: cols.rows.map((r) => ({
        name: r.column_name,
        type: r.data_type,
        udt: r.udt_name,
      })),
      rows: rows.rows,
    });
  }

  fs.writeFileSync(out, JSON.stringify(result));
  console.log("exported ->", out);
  console.log(result.tables.map((t) => `${t.table}:${t.rows.length}`).join("  "));
  await c.end();
})().catch((e) => {
  console.error("EXPORT ERROR:", e);
  process.exit(1);
});
