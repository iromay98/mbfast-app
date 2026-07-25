/*
 * Step B-1: Airtable価格Baseのスキーマとレコードを調査し、
 * フィールド→価格マスターのマッピング表（人間レビュー用）の材料を出力する。
 *   - Meta API でテーブル/フィールド定義を取得
 *   - 各対象テーブルの全レコードを取得（offsetページング）して保存
 * 出力: prisma/data/airtable/{table}.json（レコード） / docs/price-sync/airtable-schema.json
 *
 * 使い方: set -a && . ./.env && set +a && tsx scripts/price-sync/airtable-schema.mts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const outDir = join(root, "prisma", "data", "airtable");
mkdirSync(outDir, { recursive: true });
mkdirSync(join(root, "docs", "price-sync"), { recursive: true });

const PAT = process.env.AIRTABLE_PAT;
const BASE = process.env.AIRTABLE_PRICE_BASE_ID;
if (!PAT || !BASE) throw new Error("AIRTABLE_PAT / AIRTABLE_PRICE_BASE_ID が未設定です");
const H = { Authorization: `Bearer ${PAT}` };

// 同期対象15ブランド（v2仕様の対応表）
export const AIRTABLE_BRANDS = [
  { brand: "toyota", wpPageId: 9686, table: "Toyota", tableId: "tblVmbYwEgVImRQZ0" },
  { brand: "nissan", wpPageId: 9682, table: "Nissan", tableId: "tbl6jDMSlIhO9Y5ZO" },
  { brand: "lexus", wpPageId: 9673, table: "Lexus", tableId: "tbloU5637QIhFSzX1" },
  { brand: "honda", wpPageId: 3463, table: "Honda", tableId: "tbluuL2YLvwUIhUJK" },
  { brand: "mitsubishi-fuso", wpPageId: 14874, table: "Fuso", tableId: "tblCupM6TfN2xrJJn" },
  { brand: "porsche", wpPageId: 9684, table: "Porsche", tableId: "tbltkJRcPIMrELbf3" },
  { brand: "mini", wpPageId: 14154, table: "Mini", tableId: "tblW32x8z5MvrfQli" },
  { brand: "ferrari", wpPageId: 9616, table: "Ferrari", tableId: "tblXUYU8JD8D20wko" },
  { brand: "maserati", wpPageId: 9675, table: "Maserati", tableId: "tblLvZlUSwJGM2780" },
  { brand: "mclaren", wpPageId: 15852, table: "McLaren", tableId: "tbl2we0zItdoK0Zxd" },
  { brand: "landrover", wpPageId: 9671, table: "Land Rover", tableId: "tbleCUvbnT7Fg4GQN" },
  { brand: "jaguar", wpPageId: 9666, table: "Jaguar", tableId: "tblM8I4O109pTqobC" },
  { brand: "chevrolet", wpPageId: 13721, table: "Chevrolet", tableId: "tblMLHJmVHQG5n1WC" },
  { brand: "ford", wpPageId: 13593, table: "Ford", tableId: "tblPv8kuGv4NGLuW8" },
  { brand: "chrysler-dodge-jeep", wpPageId: 11024, table: "Dodge", tableId: "tblm50ZQMYtxXU8qs" },
];

// 1) Meta: テーブル/フィールド定義
const metaRes = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE}/tables`, { headers: H });
if (!metaRes.ok) throw new Error(`Meta API: HTTP ${metaRes.status} ${await metaRes.text()}`);
const meta = (await metaRes.json()) as {
  tables: { id: string; name: string; fields: { id: string; name: string; type: string; options?: unknown }[] }[];
};

const targetIds = new Set(AIRTABLE_BRANDS.map((b) => b.tableId));
const schema = meta.tables
  .filter((t) => targetIds.has(t.id))
  .map((t) => ({ id: t.id, name: t.name, fields: t.fields.map((f) => ({ name: f.name, type: f.type })) }));
writeFileSync(join(root, "docs", "price-sync", "airtable-schema.json"), JSON.stringify(schema, null, 2));
console.log(`schema取得: 対象${schema.length}/${AIRTABLE_BRANDS.length}テーブル（Base内の全テーブル数: ${meta.tables.length}）`);
for (const t of meta.tables) {
  if (!targetIds.has(t.id)) console.log(`  (対象外) ${t.name}`);
}

// 2) 各テーブル全レコード（offsetページング）
for (const b of AIRTABLE_BRANDS) {
  const records: unknown[] = [];
  let offset: string | undefined;
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE}/${b.tableId}`);
    url.searchParams.set("pageSize", "100");
    if (offset) url.searchParams.set("offset", offset);
    const res = await fetch(url, { headers: H });
    if (!res.ok) throw new Error(`${b.table}: HTTP ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { records: unknown[]; offset?: string };
    records.push(...data.records);
    offset = data.offset;
    await new Promise((r) => setTimeout(r, 250)); // rate limit (5 req/s)
  } while (offset);
  writeFileSync(join(outDir, `${b.brand}.json`), JSON.stringify(records, null, 1));
  console.log(`${b.brand.padEnd(20)} ${String(records.length).padStart(4)} records`);
}
