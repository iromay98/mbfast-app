/*
 * mbPIT: 既存のWP記事に施工区分のタグを遡って付ける。
 *
 * なぜ必要か: 記事の区分（PitPost.category）はアプリ側に最初から入っているが、
 * WordPressへの投稿時に tags を渡していなかったため、WP側にタグが1件も無い。
 * ポータルのジャンル絞り込みは記事タグを見るので、既存記事にも付ける必要がある。
 *
 * 安全のための決めごと:
 * - **既定はドライラン**。`--commit` を付けたときだけWPに書き込む
 * - タグは**足すだけ**（addPostTags が現在値を読んで和集合を書く）。既存タグを消さない
 * - 記事の本文・タイトル・状態・カテゴリには触れない（tags だけ）
 * - wpPostId が無い投稿（未公開/失敗）は対象外。WPに記事が無いので付けようがない
 * - 未知の区分は**付けない**（勝手に other に丸めない）
 *
 * 実行（本番コンテナ内）:
 *   npx tsx scripts/pit-backfill-tags.mts            # ドライラン
 *   npx tsx scripts/pit-backfill-tags.mts --commit   # 書き込み
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
const { addPostTags, fetchPostTags, tagIdsForCategory, PIT_CATEGORY_TAG_IDS, wpConfigured } =
  await import("../src/server/pit/wordpress");

if (!wpConfigured()) {
  console.error("WP_USER / WP_APP_PASSWORD が未設定です。WP認証のある環境で実行してください。");
  process.exit(2);
}

type Post = {
  id: string;
  category: string;
  status: string;
  wpPostId: number | null;
  title: string | null;
  vehicle: string;
  store: { displayName: string };
};

const adapter = new PrismaPg(process.env.DATABASE_URL);
const prisma = new PrismaClient({ adapter }) as {
  pitPost: { findMany: (a: unknown) => Promise<Post[]> };
  $disconnect: () => Promise<void>;
};

console.log(commit ? "== 遡及タグ付与（書き込み） ==" : "== 遡及タグ付与（ドライラン・書き込みなし） ==");
console.log("区分→タグID:", JSON.stringify(PIT_CATEGORY_TAG_IDS));
console.log("");

const posts = await prisma.pitPost.findMany({
  where: { status: { not: "draft" }, wpPostId: { not: null } },
  select: {
    id: true, category: true, status: true, wpPostId: true, title: true, vehicle: true,
    store: { select: { displayName: true } },
  },
  orderBy: { createdAt: "asc" },
});

console.log(`対象候補: ${posts.length}件（WP記事IDがあるもの）`);
console.log("");

let added = 0;
let already = 0;
let skipped = 0;
let failed = 0;

for (const p of posts) {
  const wpId = p.wpPostId as number;
  const tagIds = tagIdsForCategory(p.category);
  const label = `WP:${wpId} ${p.store.displayName} / ${p.vehicle} [${p.category}]`;

  if (!tagIds.length) {
    console.log(`  −  ${label} 未知の区分のため付与しない`);
    skipped++;
    continue;
  }

  try {
    if (!commit) {
      const cur = await fetchPostTags(wpId);
      const need = tagIds.filter((t) => !cur.includes(t));
      if (need.length) {
        console.log(`  +  ${label} → タグ ${need.join(",")} を付与予定（現在: ${cur.join(",") || "なし"}）`);
        added++;
      } else {
        console.log(`  =  ${label} 既に付与済み`);
        already++;
      }
      continue;
    }
    const changed = await addPostTags(wpId, tagIds);
    if (changed) {
      console.log(`  ✅ ${label} → タグ ${tagIds.join(",")} を付与`);
      added++;
    } else {
      console.log(`  =  ${label} 既に付与済み（書き込みなし）`);
      already++;
    }
  } catch (e) {
    console.error(`  ❌ ${label} 失敗: ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }
}

console.log("");
console.log(
  `${commit ? "付与" : "付与予定"} ${added} / 既に付与済み ${already} / 対象外 ${skipped} / 失敗 ${failed}`,
);
if (!commit) console.log("書き込むには --commit を付けて実行してください。");

await prisma.$disconnect();
if (failed) process.exit(1);
