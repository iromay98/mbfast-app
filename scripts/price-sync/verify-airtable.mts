/*
 * Step B-3: Airtable取込の照合レポートを生成する。
 *  - ブランドごとに「Airtableレコード数 = DB取込数」を検査
 *  - 先頭10行＋ランダム10行（シード固定）で 価格・ECU型番・車種 をAirtable原文と突き合わせ
 * 出力: docs/price-sync/REPORT-STEP-B-verify.md
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "pg";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const DB = process.env.DATABASE_URL!;
const c = new Client({ connectionString: DB.replace(/\?schema=public$/, "") });
await c.connect();

// import-airtable.mts と同じ正規化（照合はこの規則で行う）
const flat = (v: unknown): string => String(v ?? "").replace(/\r?\n+/g, " ").replace(/\s+/g, " ").trim();
function priceVal(v: unknown): string | null {
  if (v == null) return null;
  const t = flat(Array.isArray(v) ? v.join(" ") : String(v));
  if (!t || /^ask$/i.test(t)) return null;
  const digits = t.replace(/[¥￥,\s]/g, "");
  return /^\d+$/.test(digits) ? digits : t;
}
// シード固定の乱数（再現可能なランダム10行）
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const BRANDS: { id: string; file: string; priceFields: [string, string][]; carField: string; ecuField?: string }[] = [
  { id: "toyota", file: "toyota", carField: "車種", priceFields: [["limiterCut","リミッター解除のみ"],["babble","バブリングのみ"],["stage1","ECUﾁｭｰﾆﾝｸﾞ(ﾊﾞﾌﾞﾘﾝｸﾞ無料)"],["limiterOpt","リミッター解除オプション"]] },
  { id: "nissan", file: "nissan", carField: "車種", priceFields: [["babble","バブリングのみ"],["stage1","ECUﾁｭｰﾆﾝｸﾞ(ﾊﾞﾌﾞﾘﾝｸﾞ無料)"]] },
  { id: "lexus", file: "lexus", carField: "車種", priceFields: [["limiterCut","ﾘﾐｯﾀｰｶｯﾄのみ"],["babble","ﾊﾞﾌﾞﾘﾝｸﾞのみ"],["stage1","ECUﾁｭｰﾆﾝｸﾞ(ﾊﾞﾌﾞﾘﾝｸﾞ無料)"],["limiterOpt","ﾘﾐｯﾀｰｶｯﾄｵﾌﾟｼｮﾝ"]] },
  { id: "honda", file: "honda", carField: "Chassis", priceFields: [["babble","バブリングのみ"],["stage1","ECUﾁｭｰﾆﾝｸﾞ(ﾊﾞﾌﾞﾘﾝｸﾞ無料)"],["limiterOpt","リミッター解除オプション"]] },
  { id: "mitsubishi_fuso", file: "mitsubishi-fuso", carField: "Name", priceFields: [["tuning","価格"]] },
  { id: "porsche", file: "porsche", carField: "車種", priceFields: [["babble","バブリングのみ"],["stage1","ECUﾁｭｰﾆﾝｸﾞ(ﾊﾞﾌﾞﾘﾝｸﾞ無料)"]] },
  { id: "mini", file: "mini", carField: "グレード", ecuField: "ECU", priceFields: [["babble","ﾊﾞﾌﾞﾘﾝｸﾞのみ"],["stage1","ECUﾁｭｰﾆﾝｸﾞ(ﾊﾞﾌﾞﾘﾝｸﾞ無料)"]] },
  { id: "ferrari", file: "ferrari", carField: "車種", priceFields: [["babble","バブリングのみ"],["stage1","ECUﾁｭｰﾆﾝｸﾞ(ﾊﾞﾌﾞﾘﾝｸﾞ無料)"],["o2opf","O2／OPFカット"],["stage2","Stage2"],["mapswitch","MapSwitch"]] },
  { id: "maserati", file: "maserati", carField: "車種", priceFields: [["babble","ﾊﾞﾌﾞﾘﾝｸﾞのみ"],["stage1","ECUﾁｭｰﾆﾝｸﾞ(ﾊﾞﾌﾞﾘﾝｸﾞ無料)"]] },
  { id: "mclaren", file: "mclaren", carField: "車種", priceFields: [["babble","ﾊﾞﾌﾞﾘﾝｸﾞのみ"],["stage1","ECUﾁｭｰﾆﾝｸﾞ(ﾊﾞﾌﾞﾘﾝｸﾞ無料)"]] },
  { id: "landrover", file: "landrover", carField: "車種", ecuField: "ECU/TCU", priceFields: [["babble","ﾊﾞﾌﾞﾘﾝｸﾞのみ"],["stage1","ECUﾁｭｰﾆﾝｸﾞ(ﾊﾞﾌﾞﾘﾝｸﾞ無料)"],["tcu","TCUﾁｭｰﾆﾝｸﾞ"]] },
  { id: "jaguar", file: "jaguar", carField: "車種", priceFields: [["babble","ﾊﾞﾌﾞﾘﾝｸﾞのみ"],["stage1","ECUﾁｭｰﾆﾝｸﾞ(ﾊﾞﾌﾞﾘﾝｸﾞ無料)"],["tcu","TCUﾁｭｰﾆﾝｸﾞ"]] },
  { id: "chevrolet", file: "chevrolet", carField: "モデル", ecuField: "ECU/TCU", priceFields: [["babble","バブリングのみ"],["stage1","ECUﾁｭｰﾆﾝｸﾞ(ﾊﾞﾌﾞﾘﾝｸﾞ無料)"],["tcu","TCUﾁｭｰﾆﾝｸﾞ"]] },
  { id: "ford", file: "ford", carField: "モデル", ecuField: "ECU", priceFields: [["babble","ﾊﾞﾌﾞﾘﾝｸﾞのみ"],["stage1","Stage1"]] },
  { id: "chrysler_dodge_jeep", file: "chrysler-dodge-jeep", carField: "車種", priceFields: [["babble","ﾊﾞﾌﾞﾘﾝｸﾞのみ"],["stage1","ECUﾁｭｰﾆﾝｸﾞ(ﾊﾞﾌﾞﾘﾝｸﾞ無料)"]] },
];

const lines: string[] = [
  "# Step B 照合レポート — Airtable 15ブランド本取込",
  "",
  `実施日: 2026-07-25 ／ 照合方式: 先頭10行＋シード固定ランダム10行（seed=20260725）`,
  "",
  "| brand | Airtable件数 | DB件数 | 件数一致 | サンプル照合(価格/ECU/車種) |",
  "|---|---|---|---|---|",
];
let allOk = true;
const detail: string[] = [];

for (const b of BRANDS) {
  // 保存済みJSON（Step B-1のfetch結果）ではなくDBのdisplayOrder順とAirtableビュー順で照合するため、
  // ここではfetch済みJSON（ビュー順不明）を使わず、DB行を car名でAirtable原文に突き合わせる
  const src = JSON.parse(readFileSync(join(root, "prisma", "data", "airtable", `${b.file}.json`), "utf-8")) as { id: string; fields: Record<string, unknown> }[];
  const db = await c.query(
    `SELECT "carName", grade, "ecuType", prices FROM "PriceVehicle" WHERE "brandId"=$1 AND source='airtable' ORDER BY "displayOrder"`,
    [b.id],
  );
  const countOk = src.length === db.rows.length;
  if (!countOk) allOk = false;

  // 照合: 全DB行に対して「車種名＋全価格キー＋ECU」が一致するAirtable原本を1対1で対応付ける
  // （同一車種名の行が複数あるブランドがあるため、価格だけの一致では別行を掴む。原本の二重使用も禁止）
  const used = new Set<string>();
  const matchOf = new Map<number, { id: string; fields: Record<string, unknown> } | null>();
  for (let i = 0; i < db.rows.length; i++) {
    const row = db.rows[i];
    const prices = row.prices as Record<string, string>;
    const match = src.find(
      (r) =>
        !used.has(r.id) &&
        (flat(r.fields[b.carField]) || "(名称未設定)") === row.carName &&
        b.priceFields.every(([key, field]) => (priceVal(r.fields[field]) ?? "∅") === (prices[key] ?? "∅")) &&
        (!b.ecuField || (flat(r.fields[b.ecuField]) || "∅") === (row.ecuType ?? "∅")),
    );
    if (match) used.add(match.id);
    matchOf.set(i, match ?? null);
  }
  const totalNg = [...matchOf.values()].filter((m) => m === null).length;
  if (totalNg > 0) allOk = false;

  // サンプル表示: 先頭10行＋シード固定ランダム10行
  const rand = mulberry32(20260725 + b.id.length);
  const idxs = new Set<number>();
  for (let i = 0; i < Math.min(10, db.rows.length); i++) idxs.add(i);
  while (idxs.size < Math.min(20, db.rows.length)) idxs.add(Math.floor(rand() * db.rows.length));

  detail.push(`### ${b.id}（全${db.rows.length}行照合: ${totalNg === 0 ? "✅ 全行一致" : `❌ 不一致${totalNg}行`}）`, "");
  detail.push(`| # | 車種(DB) | 価格(DB) | 価格(Airtable) | ECU(DB/src) | 判定 |`, `|---|---|---|---|---|---|`);
  for (const i of [...idxs].sort((a, z) => a - z)) {
    const row = db.rows[i];
    const prices = row.prices as Record<string, string>;
    const m = matchOf.get(i);
    const dbP = b.priceFields.map(([k]) => prices[k] ?? "ask").join(" / ");
    const srcP = m ? b.priceFields.map(([, f]) => priceVal(m.fields[f]) ?? "ask").join(" / ") : "—";
    const ecu = b.ecuField ? `${row.ecuType ?? "—"} / ${m ? flat(m.fields[b.ecuField]) || "—" : "—"}` : "—";
    detail.push(`| ${i + 1} | ${row.carName} | ${dbP} | ${srcP} | ${ecu} | ${m ? "✅" : "❌ 原本なし"} |`);
  }
  detail.push("");
  lines.push(`| ${b.id} | ${src.length} | ${db.rows.length} | ${countOk ? "✅" : "❌"} | ${totalNg === 0 ? `✅ 全${db.rows.length}行一致` : `❌ 不一致${totalNg}行`} |`);
}

lines.push("", "照合方式: 車種名＋全価格キー＋ECU型番が一致するAirtable原本レコードを1対1で対応付け（原本の二重使用禁止）。件数一致＋全行対応付け成功＝取込が原本と過不足なく一致。", "", "## ブランド別サンプル（先頭10行＋ランダム10行）", "", ...detail);
lines.push(`総合判定: ${allOk ? "**合格**" : "**不合格（上記詳細を参照）**"}`);
writeFileSync(join(root, "docs", "price-sync", "REPORT-STEP-B-verify.md"), lines.join("\n") + "\n");
console.log(lines.join("\n"));
await c.end();
