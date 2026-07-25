/*
 * Step B-2: Airtable 15ブランドを価格マスター（PriceBrand/PriceVehicle）へ本取込する。
 * マッピングは docs/price-sync/REPORT-STEP-B-mapping.md（承認済み）に準拠。
 *  - market=JP / source=airtable
 *  - 行順は各テーブルの先頭グリッドビュー順（埋め込みiframeと同じ並び）
 *  - 正規化: currency数値→文字列 / "¥242,000"→"242000" / ASK・空→キー無し / 非数値価格は原文 /
 *            リモート「対応」のみtrue・要確認系はnotesへ / 改行→半角スペース
 * 再実行安全: ブランドごとに洗い替え（source=airtable の行のみ削除→再投入）
 *
 * 使い方: set -a && . ./.env && set +a && tsx scripts/price-sync/import-airtable.mts
 */
import { Client } from "pg";

const PAT = process.env.AIRTABLE_PAT;
const BASE = process.env.AIRTABLE_PRICE_BASE_ID;
const DB = process.env.DATABASE_URL;
if (!PAT || !BASE || !DB) throw new Error("AIRTABLE_PAT / AIRTABLE_PRICE_BASE_ID / DATABASE_URL が未設定です");
const H = { Authorization: `Bearer ${PAT}` };

type PriceKey = { key: string; label: string; field: string };
type BrandDef = {
  id: string;
  slug: string;
  displayName: string;
  prefix: string; // CSSプレフィックス（新設）
  wpPageId: number;
  tableId: string;
  carField: string;
  gradeField?: string;
  engineFields?: string[]; // 連結（改行畳み）
  stockField?: string;
  gainField?: string;
  laborField?: string;
  shopsField?: string;
  ecuField?: string;
  notesFields?: string[];
  makerField?: string; // cdj: seriesGroup に使う
  priceKeys: PriceKey[];
  remoteFields?: Partial<Record<"autoTuner" | "powerGate3" | "flasher" | "atOne", string>>;
};

const DEFS: BrandDef[] = [
  {
    id: "toyota", slug: "toyota", displayName: "Toyota", prefix: "toyota-", wpPageId: 9686, tableId: "tblVmbYwEgVImRQZ0",
    carField: "車種", engineFields: ["型式(排気量)"], stockField: "純正", gainField: "Stage1", laborField: "工賃", notesFields: ["備考"],
    priceKeys: [
      { key: "limiterCut", label: "リミッター解除のみ", field: "リミッター解除のみ" },
      { key: "babble", label: "バブリングのみ", field: "バブリングのみ" },
      { key: "stage1", label: "ECUチューニング(バブ無料)", field: "ECUﾁｭｰﾆﾝｸﾞ(ﾊﾞﾌﾞﾘﾝｸﾞ無料)" },
      { key: "limiterOpt", label: "リミッター解除OP", field: "リミッター解除オプション" },
    ],
    remoteFields: { autoTuner: "AutoTuner", powerGate3: "Powergate3(ﾘﾓｰﾄﾂｰﾙ)", flasher: "IXI Flasher(ﾘﾓｰﾄﾂｰﾙ)" },
  },
  {
    id: "nissan", slug: "nissan", displayName: "Nissan", prefix: "nissan-", wpPageId: 9682, tableId: "tbl6jDMSlIhO9Y5ZO",
    carField: "車種", gradeField: "グレード", stockField: "純正馬力", gainField: "Stage1", laborField: "工賃",
    priceKeys: [
      { key: "babble", label: "バブリングのみ", field: "バブリングのみ" },
      { key: "stage1", label: "ECUチューニング(バブ無料)", field: "ECUﾁｭｰﾆﾝｸﾞ(ﾊﾞﾌﾞﾘﾝｸﾞ無料)" },
    ],
    remoteFields: { autoTuner: "AutoTuner", powerGate3: "Powergate3(ﾘﾓｰﾄﾂｰﾙ)", flasher: "IXI Flasher(ﾘﾓｰﾄﾂｰﾙ)" },
  },
  {
    id: "lexus", slug: "lexus", displayName: "Lexus", prefix: "lexus-", wpPageId: 9673, tableId: "tbloU5637QIhFSzX1",
    carField: "車種", engineFields: ["ｴﾝｼﾞﾝ"], stockField: "純正", gainField: "Stage1", laborField: "工賃", shopsField: "取扱店", notesFields: ["備考"],
    priceKeys: [
      { key: "limiterCut", label: "リミッター解除のみ", field: "ﾘﾐｯﾀｰｶｯﾄのみ" },
      { key: "babble", label: "バブリングのみ", field: "ﾊﾞﾌﾞﾘﾝｸﾞのみ" },
      { key: "stage1", label: "ECUチューニング(バブ無料)", field: "ECUﾁｭｰﾆﾝｸﾞ(ﾊﾞﾌﾞﾘﾝｸﾞ無料)" },
      { key: "limiterOpt", label: "リミッター解除OP", field: "ﾘﾐｯﾀｰｶｯﾄｵﾌﾟｼｮﾝ" },
    ],
    remoteFields: { autoTuner: "AutoTuner", powerGate3: "Powergate3(ﾘﾓｰﾄﾂｰﾙ)", flasher: "IXI Flasher(ﾘﾓｰﾄﾂｰﾙ)" },
  },
  {
    id: "honda", slug: "honda", displayName: "Honda", prefix: "honda-", wpPageId: 3463, tableId: "tbluuL2YLvwUIhUJK",
    carField: "Chassis", engineFields: ["エンジン型式"], stockField: "純正", gainField: "ECUﾁｭｰﾆﾝｸﾞ(Stage1)", laborField: "工賃", notesFields: ["備考"],
    priceKeys: [
      { key: "babble", label: "バブリングのみ", field: "バブリングのみ" },
      { key: "stage1", label: "ECUチューニング(バブ無料)", field: "ECUﾁｭｰﾆﾝｸﾞ(ﾊﾞﾌﾞﾘﾝｸﾞ無料)" },
      { key: "limiterOpt", label: "リミッター解除OP", field: "リミッター解除オプション" },
    ],
    remoteFields: { autoTuner: "AutoTuner" },
  },
  {
    id: "mitsubishi_fuso", slug: "mitsubishi-fuso", displayName: "三菱ふそう", prefix: "fuso-", wpPageId: 14874, tableId: "tblCupM6TfN2xrJJn",
    carField: "Name", stockField: "純正", gainField: "チューニング",
    priceKeys: [{ key: "tuning", label: "チューニング価格", field: "価格" }],
  },
  {
    id: "porsche", slug: "porsche", displayName: "Porsche", prefix: "porsche-", wpPageId: 9684, tableId: "tbltkJRcPIMrELbf3",
    carField: "車種", gradeField: "グレード", engineFields: ["エンジン"], stockField: "純正", gainField: "Stage1", laborField: "ECU脱着等工賃",
    priceKeys: [
      { key: "babble", label: "バブリングのみ", field: "バブリングのみ" },
      { key: "stage1", label: "ECUチューニング(バブ無料)", field: "ECUﾁｭｰﾆﾝｸﾞ(ﾊﾞﾌﾞﾘﾝｸﾞ無料)" },
    ],
    remoteFields: { autoTuner: "AutoTuner", powerGate3: "Powergate3(ﾘﾓｰﾄﾂｰﾙ)", flasher: "IXI Flasher(ﾘﾓｰﾄﾂｰﾙ)" },
  },
  {
    id: "mini", slug: "mini", displayName: "MINI", prefix: "mini-", wpPageId: 14154, tableId: "tblW32x8z5MvrfQli",
    carField: "グレード", engineFields: ["エンジン"], stockField: "純正", gainField: "Stage1", laborField: "ECU脱着等工賃", ecuField: "ECU",
    priceKeys: [
      { key: "babble", label: "バブリングのみ", field: "ﾊﾞﾌﾞﾘﾝｸﾞのみ" },
      { key: "stage1", label: "ECUチューニング(バブ無料)", field: "ECUﾁｭｰﾆﾝｸﾞ(ﾊﾞﾌﾞﾘﾝｸﾞ無料)" },
    ],
    remoteFields: { autoTuner: "AutoTuner" },
  },
  {
    id: "ferrari", slug: "ferrari", displayName: "Ferrari", prefix: "ferrari-", wpPageId: 9616, tableId: "tblXUYU8JD8D20wko",
    carField: "車種", stockField: "純正", gainField: "Stage1", laborField: "脱着工賃",
    priceKeys: [
      { key: "babble", label: "バブリングのみ", field: "バブリングのみ" },
      { key: "stage1", label: "ECUチューニング(バブ無料)", field: "ECUﾁｭｰﾆﾝｸﾞ(ﾊﾞﾌﾞﾘﾝｸﾞ無料)" },
      { key: "o2opf", label: "O2/OPFカット", field: "O2／OPFカット" },
      { key: "stage2", label: "Stage2", field: "Stage2" },
      { key: "mapswitch", label: "MapSwitch", field: "MapSwitch" },
    ],
    remoteFields: { autoTuner: "AutoTuner" },
  },
  {
    id: "maserati", slug: "maserati", displayName: "Maserati", prefix: "maserati-", wpPageId: 9675, tableId: "tblLvZlUSwJGM2780",
    carField: "車種", gradeField: "グレード", engineFields: ["エンジン"], stockField: "純正", gainField: "Stage1", laborField: "ECU脱着殻割り工賃", shopsField: "取扱店",
    priceKeys: [
      { key: "babble", label: "バブリングのみ", field: "ﾊﾞﾌﾞﾘﾝｸﾞのみ" },
      { key: "stage1", label: "ECUチューニング(バブ無料)", field: "ECUﾁｭｰﾆﾝｸﾞ(ﾊﾞﾌﾞﾘﾝｸﾞ無料)" },
    ],
    remoteFields: { autoTuner: "AutoTuner(ECU/TCU)" },
  },
  {
    id: "mclaren", slug: "mclaren", displayName: "McLaren", prefix: "mclaren-", wpPageId: 15852, tableId: "tbl2we0zItdoK0Zxd",
    carField: "車種", engineFields: ["エンジン"], stockField: "純正", gainField: "Status" /* 中身はStage1ゲイン */, laborField: "工賃",
    priceKeys: [
      { key: "babble", label: "バブリングのみ", field: "ﾊﾞﾌﾞﾘﾝｸﾞのみ" },
      { key: "stage1", label: "ECUチューニング(バブ無料)", field: "ECUﾁｭｰﾆﾝｸﾞ(ﾊﾞﾌﾞﾘﾝｸﾞ無料)" },
    ],
  },
  {
    id: "landrover", slug: "landrover", displayName: "Land Rover", prefix: "landrover-", wpPageId: 9671, tableId: "tbleCUvbnT7Fg4GQN",
    carField: "車種", engineFields: ["エンジン"], stockField: "純正", gainField: "ECUﾁｭｰﾆﾝｸﾞ(Stage1)", ecuField: "ECU/TCU",
    priceKeys: [
      { key: "babble", label: "バブリングのみ", field: "ﾊﾞﾌﾞﾘﾝｸﾞのみ" },
      { key: "stage1", label: "ECUチューニング(バブ無料)", field: "ECUﾁｭｰﾆﾝｸﾞ(ﾊﾞﾌﾞﾘﾝｸﾞ無料)" },
      { key: "tcu", label: "TCUチューニング", field: "TCUﾁｭｰﾆﾝｸﾞ" },
    ],
    remoteFields: { autoTuner: "AutoTuner", atOne: "AT One(ﾘﾓｰﾄﾂｰﾙ)", powerGate3: "Powergate3(ﾘﾓｰﾄﾂｰﾙ)", flasher: "IXI Flasher(ﾘﾓｰﾄﾂｰﾙ)" },
  },
  {
    id: "jaguar", slug: "jaguar", displayName: "Jaguar", prefix: "jaguar-", wpPageId: 9666, tableId: "tblM8I4O109pTqobC",
    carField: "車種", engineFields: ["エンジン"], stockField: "純正", gainField: "ECUﾁｭｰﾆﾝｸﾞ(Stage1)",
    priceKeys: [
      { key: "babble", label: "バブリングのみ", field: "ﾊﾞﾌﾞﾘﾝｸﾞのみ" },
      { key: "stage1", label: "ECUチューニング(バブ無料)", field: "ECUﾁｭｰﾆﾝｸﾞ(ﾊﾞﾌﾞﾘﾝｸﾞ無料)" },
      { key: "tcu", label: "TCUチューニング", field: "TCUﾁｭｰﾆﾝｸﾞ" },
    ],
    remoteFields: { autoTuner: "AutoTuner(ECU/TCU)", powerGate3: "Powergate3(ﾘﾓｰﾄﾂｰﾙ)", flasher: "IXI Flasher" },
  },
  {
    id: "chevrolet", slug: "chevrolet", displayName: "Chevrolet", prefix: "chevrolet-", wpPageId: 13721, tableId: "tblMLHJmVHQG5n1WC",
    carField: "モデル", engineFields: ["エンジン"], gainField: "チューニング", ecuField: "ECU/TCU",
    priceKeys: [
      { key: "babble", label: "バブリングのみ", field: "バブリングのみ" },
      { key: "stage1", label: "ECUチューニング(バブ無料)", field: "ECUﾁｭｰﾆﾝｸﾞ(ﾊﾞﾌﾞﾘﾝｸﾞ無料)" },
      { key: "tcu", label: "TCUチューニング", field: "TCUﾁｭｰﾆﾝｸﾞ" },
    ],
    remoteFields: { autoTuner: "AutoTuner" },
  },
  {
    id: "ford", slug: "ford", displayName: "Ford", prefix: "ford-", wpPageId: 13593, tableId: "tblPv8kuGv4NGLuW8",
    carField: "モデル", engineFields: ["エンジン"], stockField: "純正", gainField: "チューニング", ecuField: "ECU",
    priceKeys: [
      { key: "babble", label: "バブリングのみ", field: "ﾊﾞﾌﾞﾘﾝｸﾞのみ" },
      { key: "stage1", label: "ECUチューニング(バブ無料)", field: "Stage1" }, // Fordのみ Stage1 が価格列
    ],
    remoteFields: { autoTuner: "AutoTuner" },
  },
  {
    id: "chrysler_dodge_jeep", slug: "chrysler-dodge-jeep", displayName: "Chrysler / Dodge / Jeep", prefix: "cdj-", wpPageId: 11024, tableId: "tblm50ZQMYtxXU8qs",
    carField: "車種", engineFields: ["エンジン"], stockField: "純正", gainField: "チューニング", laborField: "ECU脱着・殻割り工賃", notesFields: ["備考"], makerField: "メーカー",
    priceKeys: [
      { key: "babble", label: "バブリングのみ", field: "ﾊﾞﾌﾞﾘﾝｸﾞのみ" },
      { key: "stage1", label: "ECUチューニング(バブ無料)", field: "ECUﾁｭｰﾆﾝｸﾞ(ﾊﾞﾌﾞﾘﾝｸﾞ無料)" },
    ],
    remoteFields: { autoTuner: "AutoTuner" },
  },
];

// ── 正規化 ──
const flat = (v: unknown): string => String(v ?? "").replace(/\r?\n+/g, " ").replace(/\s+/g, " ").trim();
function priceVal(v: unknown): string | null {
  if (v == null) return null;
  const raw = Array.isArray(v) ? v.join(" ") : String(v);
  const t = flat(raw);
  if (!t || /^ask$/i.test(t)) return null;
  const digits = t.replace(/[¥￥,\s]/g, "");
  if (/^\d+$/.test(digits)) return digits;
  return t; // "+¥22,000" "¥297,000~" 等は原文のまま
}
function remoteVal(v: unknown): { on: boolean; note: string | null } {
  const t = flat(Array.isArray(v) ? v[0] : v);
  if (!t) return { on: false, note: null };
  if (t === "対応") return { on: true, note: null };
  if (t === "非対応") return { on: false, note: null };
  return { on: false, note: t }; // 要確認・要動作確認など
}
function seriesOf(def: BrandDef, fields: Record<string, unknown>, carName: string): string {
  if (def.makerField) return flat(fields[def.makerField]) || "その他";
  const head = carName.replace(/\(.*/, "").trim().split(" ")[0];
  return head || "その他";
}

// 列定義（columns Json）をマッピングから機械生成
function buildColumns(def: BrandDef) {
  const cols: Record<string, unknown>[] = [];
  let o = 0;
  cols.push({ key: "car", label: "車種", type: "text", order: o++ });
  if (def.gradeField) cols.push({ key: "grade", label: "グレード", type: "text", order: o++ });
  if (def.engineFields?.length) cols.push({ key: "engine", label: "エンジン", type: "text", order: o++ });
  for (const pk of def.priceKeys) {
    cols.push({ key: pk.key, label: pk.label, type: "price", emphasis: pk.key === "stage1" || pk.key === "babble" ? "primary" : "secondary", emptyBehavior: "line-btn", order: o++ });
  }
  if (def.stockField) cols.push({ key: "stockOutput", label: "純正出力", type: "output", order: o++ });
  if (def.gainField) cols.push({ key: "stage1Gain", label: "Stage1出力向上", type: "output", order: o++ });
  if (def.laborField) cols.push({ key: "labor", label: "工賃", type: "labor", order: o++ });
  if (def.shopsField) cols.push({ key: "shops", label: "対応店舗", type: "shops", order: o++ });
  if (def.remoteFields) cols.push({ key: "remote", label: "リモート", type: "remote", order: o++ });
  if (def.ecuField) cols.push({ key: "ecuType", label: "ECU/TCU型番", type: "ecu", order: o++ });
  return cols;
}

// ── 実行 ──
const c = new Client({ connectionString: DB.replace(/\?schema=public$/, "") });
await c.connect();

// 各テーブルの先頭グリッドビュー（埋め込みと同じ並び）を取得
const metaRes = await fetch(`https://api.airtable.com/v0/meta/bases/${BASE}/tables`, { headers: H });
if (!metaRes.ok) throw new Error(`Meta API: ${metaRes.status}`);
const meta = (await metaRes.json()) as { tables: { id: string; views: { id: string; type: string }[] }[] };
const firstView = new Map(meta.tables.map((t) => [t.id, t.views.find((v) => v.type === "grid")?.id]));

let grand = 0;
for (const def of DEFS) {
  // レコード取得（ビュー順）
  const records: { id: string; fields: Record<string, unknown> }[] = [];
  let offset: string | undefined;
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE}/${def.tableId}`);
    url.searchParams.set("pageSize", "100");
    const view = firstView.get(def.tableId);
    if (view) url.searchParams.set("view", view);
    if (offset) url.searchParams.set("offset", offset);
    const res = await fetch(url, { headers: H });
    if (!res.ok) throw new Error(`${def.id}: HTTP ${res.status} ${await res.text()}`);
    const data = (await res.json()) as { records: { id: string; fields: Record<string, unknown> }[]; offset?: string };
    records.push(...data.records);
    offset = data.offset;
    await new Promise((r) => setTimeout(r, 250));
  } while (offset);

  // seriesGroups（出現順）
  const seriesList: string[] = [];
  const rows = records.map((r) => {
    const f = r.fields;
    const carName = flat(f[def.carField]) || "(名称未設定)";
    const series = seriesOf(def, f, carName);
    if (!seriesList.includes(series)) seriesList.push(series);

    const prices: Record<string, string> = {};
    for (const pk of def.priceKeys) {
      const v = priceVal(f[pk.field]);
      if (v != null) prices[pk.key] = v;
    }
    const remote: Record<string, boolean> = {};
    const remoteNotes: string[] = [];
    if (def.remoteFields) {
      for (const [flag, field] of Object.entries(def.remoteFields)) {
        const { on, note } = remoteVal(f[field]);
        remote[flag] = on;
        if (note) remoteNotes.push(`${field.replace(/\(.*/, "")}:${note}`);
      }
    }
    const notes = [
      ...(def.notesFields ?? []).map((n) => flat(f[n])).filter(Boolean),
      ...remoteNotes,
    ].join(" / ") || null;

    return {
      airtableId: r.id,
      seriesGroup: series,
      carName,
      grade: def.gradeField ? flat(f[def.gradeField]) || null : null,
      engine: (def.engineFields ?? []).map((e) => flat(f[e])).filter(Boolean).join(" "),
      stockOutput: def.stockField ? flat(f[def.stockField]) || null : null,
      stage1Gain: def.gainField ? flat(f[def.gainField]) || null : null,
      labor: def.laborField ? flat(f[def.laborField]) || null : null,
      shops: def.shopsField ? flat(f[def.shopsField]) || null : null,
      ecuType: def.ecuField ? flat(f[def.ecuField]) || null : null,
      prices,
      remote,
      notes,
    };
  });

  // ブランドupsert＋洗い替え投入
  await c.query(
    `INSERT INTO "PriceBrand" (id,"displayName",slug,"namespacePrefix","seriesGroups",columns,"csvMapping",intro,"jsonLdDescription","wordPressPageId","displayOrder","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,'{}','','',$7,$8,now(),now())
     ON CONFLICT (id) DO UPDATE SET
       "displayName"=EXCLUDED."displayName", slug=EXCLUDED.slug, "namespacePrefix"=EXCLUDED."namespacePrefix",
       "seriesGroups"=EXCLUDED."seriesGroups", columns=EXCLUDED.columns, "wordPressPageId"=EXCLUDED."wordPressPageId", "updatedAt"=now()`,
    [def.id, def.displayName, def.slug, def.prefix, seriesList, JSON.stringify(buildColumns(def)), def.wpPageId, 100 + DEFS.indexOf(def)],
  );
  await c.query(`DELETE FROM "PriceVehicle" WHERE "brandId"=$1 AND source='airtable'`, [def.id]);
  let i = 0;
  for (const row of rows) {
    await c.query(
      `INSERT INTO "PriceVehicle"
        (id,"brandId",market,source,"seriesGroup","carName",grade,engine,"engineFamily","ecuType","stockOutput","stage1Gain",prices,labor,shops,remote,notes,"displayOrder","createdAt","updatedAt")
       VALUES (gen_random_uuid()::text,$1,'JP','airtable',$2,$3,$4,$5,NULL,$6,$7,$8,$9,$10,$11,$12,$13,$14,now(),now())`,
      [def.id, row.seriesGroup, row.carName, row.grade, row.engine, row.ecuType, row.stockOutput, row.stage1Gain,
       JSON.stringify(row.prices), row.labor, row.shops, JSON.stringify(row.remote), row.notes, i++],
    );
  }
  grand += rows.length;
  console.log(`${def.id.padEnd(22)} ${String(rows.length).padStart(4)} 行投入 (series=${seriesList.length})`);
}
console.log(`\n合計 ${grand} 行を market=JP / source=airtable で投入しました`);
await c.end();
