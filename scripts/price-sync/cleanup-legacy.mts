/*
 * 価格マスターの重複掃除。WP由来（source='html'）を正として、
 *   (a) 旧Airtable由来のコピー行（source='airtable'）
 *   (b) 新idと重複している旧ブランドid（chrysler_dodge_jeep→cdj / mitsubishi_fuso→fuso 等）
 * を削除する。
 *
 * なぜ必要か: WP取込で27ブランド1,659行が入った結果、Airtable由来494行と二重になり
 * /hq/prices で同じ車種が2回出る状態になっている。
 *
 * **代理店が貼っている本物のAirtableには一切触れない**（ここはアプリDBの掃除だけ）。
 * Airtableへ新料金を書き戻すのは別スクリプト（airtable-push）の仕事。
 *
 * 安全弁（今日 audi/bmw のデータが消えた事故の再発防止）:
 *   - **そのブランドに html 行が無ければ airtable 行を消さない**（消して空にしない）
 *   - 旧idを消すのは、置換先の新idが存在し **行数が同じか多い** ときだけ
 *   - 既定は読み取りのみ。--commit かつ --i-have-backed-up が揃って初めて削除する
 *   - 削除は1トランザクション（途中で落ちても中途半端に消えない）
 *
 * 使い方:
 *   npm run prices:cleanup-dry                      … 何を消すかの報告だけ（DB無変更）
 *   npm run prices:cleanup -- --i-have-backed-up    … 実行（本番コンテナ内で）
 */

// 旧id → 置換先の新id。旧idは新idと中身が重複しているため片方だけ残す。
const LEGACY_TO_NEW: Record<string, string> = {
  chrysler_dodge_jeep: "cdj",
  mitsubishi_fuso: "fuso",
  mercedes_gasoline: "mb",
  mercedes_diesel: "mbd",
  lamborghini: "lambo",
};

const args = process.argv.slice(2);
const commit = args.includes("--commit");
const backed = args.includes("--i-have-backed-up");

const { PrismaClient } = (await import("../../src/generated/prisma/client")) as {
  PrismaClient: new (o: unknown) => unknown;
};
const { PrismaPg } = (await import("@prisma/adapter-pg")) as { PrismaPg: new (s: string) => unknown };

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL が必要（本番コンテナ内で実行する前提）。");
  process.exit(2);
}
const adapter = new PrismaPg(process.env.DATABASE_URL);
const prisma = new PrismaClient({ adapter }) as {
  priceVehicle: {
    groupBy: (a: unknown) => Promise<{ brandId: string; source: string; _count: number }[]>;
    deleteMany: (a: unknown) => Promise<{ count: number }>;
  };
  priceBrand: {
    findMany: (a: unknown) => Promise<{ id: string }[]>;
    deleteMany: (a: unknown) => Promise<{ count: number }>;
  };
  $transaction: (ops: unknown[]) => Promise<unknown>;
  $disconnect: () => Promise<void>;
};

// ブランド×source の行数を実測する
const grouped = await prisma.priceVehicle.groupBy({
  by: ["brandId", "source"],
  _count: true,
});
const rows = new Map<string, Map<string, number>>();
for (const g of grouped) {
  if (!rows.has(g.brandId)) rows.set(g.brandId, new Map());
  rows.get(g.brandId)!.set(g.source, g._count);
}
const htmlCount = (b: string) => rows.get(b)?.get("html") ?? 0;
const airtableCount = (b: string) => rows.get(b)?.get("airtable") ?? 0;
const totalCount = (b: string) => [...(rows.get(b)?.values() ?? [])].reduce((a, c) => a + c, 0);

console.log("════════ 価格マスター 重複掃除 ════════");
console.log(commit ? "モード: --commit（削除する）" : "モード: 読み取りのみ（DBは変更しない）");
console.log("");

// ── (a) airtable コピー行: html 行があるブランドだけ消す ──
const airtableBrands = [...rows.keys()].filter((b) => airtableCount(b) > 0).sort();
const deletableAirtable: string[] = [];
const keptAirtable: string[] = [];
console.log("── (a) Airtable由来のコピー行 ──");
for (const b of airtableBrands) {
  const at = airtableCount(b);
  const ht = htmlCount(b);
  if (ht > 0) {
    deletableAirtable.push(b);
    console.log(`  削除 ${b.padEnd(22)} airtable ${String(at).padStart(4)}行 → html ${ht}行が残る`);
  } else {
    keptAirtable.push(b);
    console.log(`  ★保持 ${b.padEnd(21)} airtable ${String(at).padStart(4)}行 （html行が無いため消さない）`);
  }
}
if (airtableBrands.length === 0) console.log("  対象なし");

// ── (b) 旧id: 置換先の新idが同数以上あるときだけ消す ──
console.log("");
console.log("── (b) 新idと重複している旧ブランドid ──");
const existing = new Set((await prisma.priceBrand.findMany({ select: { id: true } })).map((b) => b.id));
const deletableLegacy: string[] = [];
for (const [oldId, newId] of Object.entries(LEGACY_TO_NEW)) {
  if (!existing.has(oldId)) continue;
  const oldRows = totalCount(oldId);
  const newRows = totalCount(newId);
  if (!existing.has(newId)) {
    console.log(`  ★保持 ${oldId} → 置換先 ${newId} が存在しないため消さない（旧${oldRows}行）`);
    continue;
  }
  if (newRows < oldRows) {
    console.log(`  ★保持 ${oldId}(${oldRows}行) → ${newId}(${newRows}行) が少ないため消さない`);
    continue;
  }
  deletableLegacy.push(oldId);
  console.log(`  削除 ${oldId.padEnd(22)} ${oldRows}行 → ${newId} に ${newRows}行あり`);
}
if (deletableLegacy.length === 0 && !Object.keys(LEGACY_TO_NEW).some((o) => existing.has(o))) {
  console.log("  対象なし");
}

// ── 実行 ──
const airtableRowsToDelete = deletableAirtable.reduce((a, b) => a + airtableCount(b), 0);
const legacyRowsToDelete = deletableLegacy.reduce((a, b) => a + totalCount(b), 0);
console.log("");
console.log(
  `合計: airtable ${airtableRowsToDelete}行 / 旧idブランド ${deletableLegacy.length}件(${legacyRowsToDelete}行)`,
);
if (keptAirtable.length) {
  console.log(`※ html行が無く保持したブランド: ${keptAirtable.join(", ")}（先にWP取込が必要）`);
}

if (!commit) {
  console.log("\n読み取りのみで終了。削除するには --commit --i-have-backed-up を付ける。");
  await prisma.$disconnect();
  process.exit(0);
}
if (!backed) {
  console.error(
    "\nガード: --commit は先に pg_dump 退避が必須。退避後 --i-have-backed-up を付けて再実行。",
  );
  await prisma.$disconnect();
  process.exit(2);
}

await prisma.$transaction([
  prisma.priceVehicle.deleteMany({
    where: { source: "airtable", brandId: { in: deletableAirtable } },
  }),
  prisma.priceVehicle.deleteMany({ where: { brandId: { in: deletableLegacy } } }),
  prisma.priceBrand.deleteMany({ where: { id: { in: deletableLegacy } } }),
]);
console.log("\n削除しました。");
await prisma.$disconnect();
