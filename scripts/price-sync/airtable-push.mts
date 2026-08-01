/*
 * アプリ（価格マスター）→ Airtable への書き戻し。
 *
 * なぜ必要か: 代理店が自分のサイトに **Airtableの埋め込み** を貼っているため、
 * 本部が /hq/prices で料金を変えても、Airtable側が古いままだと代理店の表示が古くなる。
 * アプリを原本、Airtableを鏡（バックアップ）として更新し続ける。
 *
 * 設計（WP同期と同じ思想。代理店の表示を壊さないことを最優先）:
 *  - **既定は読み取りのみ**（差分レポート）。`--yes` を付けたときだけ書き込む
 *  - **既存レコードの更新だけ**。レコードの新規作成・削除は一切しない
 *    （Airtable側の行構成や他の列を壊さない。行の増減は人が判断する）
 *  - **書き込むのは価格系フィールドだけ**（priceKeys と 工賃）。車種名・エンジン・備考等は触らない
 *  - **対応付けできなかったブランドは1件も書かない**（部分的に壊れた状態を作らない）
 *  - 対応付けは「車種＋グレード＋エンジン」の正規化キーで1対1。重複や曖昧はスキップして報告
 *
 * 使い方:
 *   npm run prices:airtable-diff              … 差分レポートのみ（Airtableへ書き込まない）
 *   npm run prices:airtable-push -- --yes     … 実際に書き戻す
 *   （--brand=toyota で1ブランドだけに絞れる）
 *
 * 認証: AIRTABLE_PAT / AIRTABLE_PRICE_BASE_ID（.env のみ。コミット禁止）
 */

import { AIRTABLE_DEFS, type BrandDef } from "./airtable-defs.mts";

const args = process.argv.slice(2);
const doWrite = args.includes("--yes");
const brandFilter = args.find((a) => a.startsWith("--brand="))?.slice("--brand=".length);

const PAT = process.env.AIRTABLE_PAT;
const BASE = process.env.AIRTABLE_PRICE_BASE_ID;
if (!PAT || !BASE) {
  console.error(
    "AIRTABLE_PAT / AIRTABLE_PRICE_BASE_ID が未設定です。\n" +
      "本番で動かすには docker-compose.prod.yml の environment に列挙され、かつ .env に値がある必要があります。",
  );
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL が必要（本番コンテナ内で実行する前提）。");
  process.exit(2);
}

const H = { Authorization: `Bearer ${PAT}` };

/** Airtable の全レコード取得（offsetページング） */
async function fetchAll(tableId: string): Promise<{ id: string; fields: Record<string, unknown> }[]> {
  const out: { id: string; fields: Record<string, unknown> }[] = [];
  let offset: string | undefined;
  do {
    const url = new URL(`https://api.airtable.com/v0/${BASE}/${tableId}`);
    url.searchParams.set("pageSize", "100");
    if (offset) url.searchParams.set("offset", offset);
    const res = await fetch(url, { headers: H });
    if (!res.ok) throw new Error(`Airtable GET ${tableId}: HTTP ${res.status} ${await res.text()}`);
    const data = (await res.json()) as {
      records: { id: string; fields: Record<string, unknown> }[];
      offset?: string;
    };
    out.push(...data.records);
    offset = data.offset;
  } while (offset);
  return out;
}

/** 10件ずつ PATCH（Airtableの上限）。typecast は使わない＝型を勝手に変えない */
async function patchRecords(
  tableId: string,
  records: { id: string; fields: Record<string, unknown> }[],
): Promise<void> {
  for (let i = 0; i < records.length; i += 10) {
    const chunk = records.slice(i, i + 10);
    const res = await fetch(`https://api.airtable.com/v0/${BASE}/${tableId}`, {
      method: "PATCH",
      headers: { ...H, "Content-Type": "application/json" },
      body: JSON.stringify({ records: chunk }),
    });
    if (!res.ok) throw new Error(`Airtable PATCH ${tableId}: HTTP ${res.status} ${await res.text()}`);
  }
}

const flat = (v: unknown): string => {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(flat).filter(Boolean).join(" ");
  if (typeof v === "number") return String(v);
  return String(v).trim();
};

/** 対応付け用の正規化キー: 全角半角・空白・カナ幅の揺れを潰す */
function normKey(...parts: string[]): string {
  return parts
    .join("|")
    .normalize("NFKC")
    .replace(/[\s　]+/g, "")
    .toLowerCase();
}

/**
 * アプリ側の価格文字列 → Airtable へ入れる値。
 * Airtable の元の型に合わせる: 元が number なら number、それ以外は文字列のまま。
 * （currency列に文字列を入れると型エラー、逆も表示崩れになる）
 */
function toAirtableValue(appValue: string, current: unknown): unknown {
  if (appValue === "") return "";
  const numeric = /^\d+$/.test(appValue);
  if (typeof current === "number" && numeric) return Number(appValue);
  if (current === null || current === undefined) return numeric ? Number(appValue) : appValue;
  return appValue;
}

const { PrismaClient } = (await import("../../src/generated/prisma/client")) as {
  PrismaClient: new (o: unknown) => unknown;
};
const { PrismaPg } = (await import("@prisma/adapter-pg")) as { PrismaPg: new (s: string) => unknown };
const adapter = new PrismaPg(process.env.DATABASE_URL);
type AppVeh = {
  carName: string;
  grade: string | null;
  engine: string;
  prices: unknown;
  labor: string | null;
};
const prisma = new PrismaClient({ adapter }) as {
  priceVehicle: { findMany: (a: unknown) => Promise<AppVeh[]> };
  $disconnect: () => Promise<void>;
};

console.log("════════ アプリ → Airtable 書き戻し ════════");
console.log(doWrite ? "モード: --yes（Airtableへ書き込む）" : "モード: 読み取りのみ（差分レポート）");
console.log("方式: 既存レコードの価格系フィールドのみ更新／作成・削除はしない");
console.log("");

let totalChanges = 0;
let blockedBrands = 0;

for (const def of AIRTABLE_DEFS as BrandDef[]) {
  if (brandFilter && def.id !== brandFilter) continue;

  // アプリ側（WP由来を正とする＝source='html'）。掃除後は html のみが残る想定。
  const appRows = await prisma.priceVehicle.findMany({
    where: { brandId: def.id, source: "html" },
    select: { carName: true, grade: true, engine: true, prices: true, labor: true },
  });
  if (appRows.length === 0) {
    console.log(`■ ${def.id}: アプリ側に行が無いためスキップ（取込前の可能性）`);
    continue;
  }

  let at: { id: string; fields: Record<string, unknown> }[];
  try {
    at = await fetchAll(def.tableId);
  } catch (e) {
    console.log(`■ ${def.id}: Airtable取得に失敗 → スキップ  ${e instanceof Error ? e.message : ""}`);
    blockedBrands++;
    continue;
  }

  // Airtable側のキー → レコード（重複キーは曖昧なので除外する）
  const atByKey = new Map<string, { id: string; fields: Record<string, unknown> }>();
  const dupKeys = new Set<string>();
  for (const r of at) {
    const car = flat(r.fields[def.carField]);
    const grade = def.gradeField ? flat(r.fields[def.gradeField]) : "";
    const engine = (def.engineFields ?? []).map((f) => flat(r.fields[f])).join(" ");
    const k = normKey(car, grade, engine);
    if (atByKey.has(k)) dupKeys.add(k);
    atByKey.set(k, r);
  }
  for (const k of dupKeys) atByKey.delete(k);

  const updates: { id: string; fields: Record<string, unknown> }[] = [];
  const changeLines: string[] = [];
  let unmatched = 0;

  for (const v of appRows) {
    const k = normKey(v.carName, v.grade ?? "", v.engine);
    const rec = atByKey.get(k);
    if (!rec) {
      unmatched++;
      continue;
    }
    const prices = (v.prices ?? {}) as Record<string, string>;
    const fields: Record<string, unknown> = {};

    for (const pk of def.priceKeys) {
      const appVal = prices[pk.key];
      if (appVal === undefined) continue; // ask（キー無し）は触らない＝Airtableの現状を壊さない
      const cur = rec.fields[pk.field];
      const next = toAirtableValue(appVal, cur);
      if (flat(cur) !== flat(next)) {
        fields[pk.field] = next;
        changeLines.push(`     ${v.carName} ${pk.label}: ${flat(cur) || "（空）"} → ${flat(next)}`);
      }
    }
    if (def.laborField && v.labor !== null && v.labor !== "—") {
      const cur = rec.fields[def.laborField];
      const next = toAirtableValue(v.labor, cur);
      if (flat(cur) !== flat(next)) {
        fields[def.laborField] = next;
        changeLines.push(`     ${v.carName} 工賃: ${flat(cur) || "（空）"} → ${flat(next)}`);
      }
    }
    if (Object.keys(fields).length) updates.push({ id: rec.id, fields });
  }

  const matchRate = appRows.length ? ((appRows.length - unmatched) / appRows.length) * 100 : 0;
  console.log(
    `■ ${def.id} (${def.displayName})  アプリ${appRows.length}行 / Airtable${at.length}行  ` +
      `対応${appRows.length - unmatched}件(${matchRate.toFixed(0)}%)  変更${updates.length}件`,
  );
  if (dupKeys.size) console.log(`   注意: Airtable側に重複キー ${dupKeys.size}件 → その行は触らない`);
  if (unmatched) console.log(`   注意: 対応先が見つからない ${unmatched}件 → その行は触らない`);

  /*
   * 安全弁: 対応付けが8割未満のブランドは「マッピングが合っていない」可能性が高いので
   * 1件も書かない（中途半端に一部だけ書き換えて代理店の表を壊すのを防ぐ）。
   */
  if (matchRate < 80) {
    console.log(`   ✗ 対応付けが ${matchRate.toFixed(0)}% しかないため **このブランドは書き込まない**`);
    blockedBrands++;
    continue;
  }
  for (const l of changeLines.slice(0, 8)) console.log(l);
  if (changeLines.length > 8) console.log(`     …他 ${changeLines.length - 8}件`);
  totalChanges += updates.length;

  if (doWrite && updates.length) {
    await patchRecords(def.tableId, updates);
    console.log(`   → ${updates.length}件をAirtableへ書き込みました`);
  }
}

console.log("");
console.log(`変更対象 合計 ${totalChanges}件 / 書き込み対象外のブランド ${blockedBrands}件`);
if (!doWrite) {
  console.log("※ このコマンドはAirtableへ書き込みません。書き込みは --yes を付けて実行。");
}
await prisma.$disconnect();
