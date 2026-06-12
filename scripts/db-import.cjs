// db-export.cjs が作った JSON を本番DBへ投入（既存データは置換）。
// 本番コンテナ内で実行: node scripts/db-import.cjs /tmp/mbfast-data.json   （要 DATABASE_URL）
// session_replication_role=replica でFK制約を一時無効化し、全テーブルを TRUNCATE→INSERT。
const { Client } = require("pg");
const fs = require("fs");

(async () => {
  const file = process.argv[2] || "mbfast-data.json";
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  const c = new Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();

  const q = (id) => `"${id.replace(/"/g, '""')}"`;
  const allTables = data.tables.map((t) => q(t.table)).join(", ");

  await c.query("BEGIN");
  try {
    await c.query("SET session_replication_role = replica");
    if (data.tables.length) {
      await c.query(`TRUNCATE TABLE ${allTables} RESTART IDENTITY CASCADE`);
    }

    for (const t of data.tables) {
      if (!t.rows.length) continue;
      const colMeta = new Map(t.columns.map((col) => [col.name, col]));
      const colNames = t.columns.map((col) => col.name);
      for (const row of t.rows) {
        const params = [];
        const placeholders = colNames.map((name) => {
          const meta = colMeta.get(name);
          const v = row[name];
          const i = params.length + 1;
          if (v === null || v === undefined) {
            params.push(null);
            return `$${i}`;
          }
          if (meta.type === "json" || meta.type === "jsonb") {
            params.push(JSON.stringify(v));
            return `$${i}::jsonb`;
          }
          // ARRAY (text[] 等) はそのまま JS 配列を渡せば pg がリテラル化
          params.push(v);
          return `$${i}`;
        });
        await c.query(
          `INSERT INTO ${q(t.table)} (${colNames.map(q).join(", ")}) VALUES (${placeholders.join(", ")})`,
          params,
        );
      }
      console.log(`  ${t.table}: ${t.rows.length} 行`);
    }

    await c.query("SET session_replication_role = DEFAULT");
    await c.query("COMMIT");
    console.log("インポート完了");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    await c.end();
  }
})().catch((e) => {
  console.error("IMPORT ERROR:", e);
  process.exit(1);
});
