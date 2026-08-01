/*
 * Airtable の Base ID を本番DBから復元する（読み取り専用）。
 *
 * 経緯: 価格表のWPページは元々 Airtable の iframe 埋め込みで、7/26に生成HTMLへ置換した。
 * そのとき **置換前のHTML全文** を PriceSyncLog.backup に保存している。
 * iframe の src は https://airtable.com/embed/app.../shr... の形なので、
 * ここから Base ID（app… ）を拾える。
 *
 * Base ID は秘密情報ではない（公開ページの埋め込みURLに載っていた値）。
 * **PAT（トークン）はここからは分からない**＝そちらは新規発行が必要。
 *
 * 使い方（本番コンテナ内）: npx tsx scripts/price-sync/find-airtable-base.mts
 */

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL が必要（本番コンテナ内で実行する前提）。");
  process.exit(2);
}

const { PrismaClient } = (await import("../../src/generated/prisma/client")) as {
  PrismaClient: new (o: unknown) => unknown;
};
const { PrismaPg } = (await import("@prisma/adapter-pg")) as { PrismaPg: new (s: string) => unknown };
const adapter = new PrismaPg(process.env.DATABASE_URL);
const prisma = new PrismaClient({ adapter }) as {
  priceSyncLog: {
    findMany: (a: unknown) => Promise<{ wpPageId: number; backup: string | null; createdAt: Date }[]>;
  };
  $disconnect: () => Promise<void>;
};

const logs = await prisma.priceSyncLog.findMany({
  where: { backup: { not: null } },
  select: { wpPageId: true, backup: true, createdAt: true },
  orderBy: { createdAt: "asc" },
});

console.log(`PriceSyncLog: backup を持つ行 ${logs.length}件を走査`);

// Base ID（app…）と共有ビューID（shr…）を拾う。ページごとに最初の1件でよい。
const bases = new Map<string, { pages: Set<number>; sample: string }>();
const RE = /airtable\.com\/(?:embed\/)?(app[A-Za-z0-9]+)(?:\/(shr[A-Za-z0-9]+))?/g;

for (const l of logs) {
  if (!l.backup) continue;
  for (const m of l.backup.matchAll(RE)) {
    const base = m[1];
    if (!bases.has(base)) bases.set(base, { pages: new Set(), sample: m[0] });
    bases.get(base)!.pages.add(l.wpPageId);
  }
}

console.log("");
if (bases.size === 0) {
  console.log("✗ Base ID は見つかりませんでした。");
  console.log("  （置換前HTMLにairtableのURLが残っていない可能性。Airtableの画面URLから取得してください）");
} else {
  console.log("════════ 見つかった Airtable Base ID ════════");
  for (const [base, info] of bases) {
    const pages = [...info.pages].sort((a, b) => a - b);
    console.log(`  ${base}`);
    console.log(`    出現したWPページ(${pages.length}件): ${pages.join(", ")}`);
    console.log(`    例: ${info.sample}`);
  }
  console.log("");
  if (bases.size === 1) {
    const only = [...bases.keys()][0];
    console.log(`→ AIRTABLE_PRICE_BASE_ID に入れる値: ${only}`);
  } else {
    console.log("→ 複数見つかりました。出現ページ数が最も多いものが価格Baseの可能性が高いです（人が確認してください）");
  }
  console.log("※ PAT（トークン）はDBからは分かりません。Airtableで新規発行が必要です。");
}

await prisma.$disconnect();
