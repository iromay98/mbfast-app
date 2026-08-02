/*
 * mbPIT: 公開済み記事の中の「施工店」リンクを、現在の店舗slugに直す。
 *
 * なぜ必要か: 記事末尾の店舗リンクは投稿時に storePageUrl(store.slug) で焼き込まれる。
 * 店舗のslugを後から変えると、**過去記事のリンクだけ古いURLのまま残って404になる**。
 * （実例: RAF INDUSTRIES が旧名 Anubis Garage から改名し、slugの綴りも直したケース）
 *
 * 安全のための決めごと:
 * - **既定はドライラン**。`--commit` を付けたときだけWPに書き込む
 * - 置き換えるのは `<HUB>/<1セグメント>/` の形のURLだけ。本文の他の部分には触れない
 * - **他店舗のslugを指すリンクは書き換えない**（記事間の相互リンクを壊さないため）
 * - mbPITハブ（<HUB> そのもの）にも触れない
 * - 差分が無い記事はWPに書き込まない
 *
 * 実行（本番コンテナ内）:
 *   npx tsx scripts/pit-fix-store-links.mts            # ドライラン
 *   npx tsx scripts/pit-fix-store-links.mts --commit   # 書き込み
 */

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL が必要（本番コンテナ内で実行する前提）。");
  process.exit(2);
}

const commit = process.argv.includes("--commit");

const { PrismaClient } = (await import("../src/generated/prisma/client")) as {
  PrismaClient: new (o: unknown) => unknown;
};
const { PrismaPg } = (await import("@prisma/adapter-pg")) as { PrismaPg: new (s: string) => unknown };
const { fetchPostContent, updatePost, wpConfigured } = await import("../src/server/pit/wordpress");
const { MBPIT_HUB_URL } = await import("../src/server/pit/generate");

if (!wpConfigured()) {
  console.error("WP_USER / WP_APP_PASSWORD が未設定です。WP認証のある環境で実行してください。");
  process.exit(2);
}

type Post = {
  id: string;
  wpPostId: number | null;
  vehicle: string;
  store: { displayName: string; slug: string };
};

const adapter = new PrismaPg(process.env.DATABASE_URL);
const prisma = new PrismaClient({ adapter }) as {
  pitPost: { findMany: (a: unknown) => Promise<Post[]> };
  pitStore: { findMany: (a: unknown) => Promise<{ slug: string }[]> };
  $disconnect: () => Promise<void>;
};

console.log(commit ? "== 店舗リンク修正（書き込み） ==" : "== 店舗リンク修正（ドライラン・書き込みなし） ==");
console.log(`ハブURL: ${MBPIT_HUB_URL}`);

// 現存する全店舗のslug。ここに載っているslugへのリンクは「正しい別店舗へのリンク」なので触らない
const allSlugs = new Set((await prisma.pitStore.findMany({ select: { slug: true } })).map((s) => s.slug));

const posts = await prisma.pitPost.findMany({
  where: { status: { not: "draft" }, wpPostId: { not: null } },
  select: {
    id: true, wpPostId: true, vehicle: true,
    store: { select: { displayName: true, slug: true } },
  },
  orderBy: { createdAt: "asc" },
});

console.log(`対象候補: ${posts.length}件（WP記事IDがあるもの）`);
console.log("");

// <HUB><slug>/ の形（slugは1セグメント）だけを拾う
const HUB_RE = new RegExp(`${MBPIT_HUB_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([a-z0-9-]+)/`, "g");

let fixed = 0;
let ok = 0;
let failed = 0;

for (const p of posts) {
  const wpId = p.wpPostId as number;
  const label = `WP:${wpId} ${p.store.displayName} / ${p.vehicle}`;
  try {
    const { title, contentRaw } = await fetchPostContent(wpId);
    void title;
    const stale = new Set<string>();
    for (const m of contentRaw.matchAll(HUB_RE)) {
      const slug = m[1];
      if (slug === p.store.slug) continue; // 正しい
      if (allSlugs.has(slug)) continue; // 別店舗への正当なリンク
      stale.add(slug);
    }
    if (!stale.size) {
      console.log(`  =  ${label} 修正不要`);
      ok++;
      continue;
    }
    let next = contentRaw;
    for (const old of stale) {
      next = next.split(`${MBPIT_HUB_URL}${old}/`).join(`${MBPIT_HUB_URL}${p.store.slug}/`);
    }
    console.log(`  +  ${label} ${[...stale].map((s) => `${s} → ${p.store.slug}`).join(", ")}`);
    if (commit) {
      await updatePost(wpId, { content: next });
      console.log(`     ✅ 書き込みました`);
    }
    fixed++;
  } catch (e) {
    console.error(`  ❌ ${label} 失敗: ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }
}

console.log("");
console.log(`${commit ? "修正" : "修正予定"} ${fixed} / 修正不要 ${ok} / 失敗 ${failed}`);
if (!commit && fixed) console.log("書き込むには --commit を付けて実行してください。");

await prisma.$disconnect();
if (failed) process.exit(1);
