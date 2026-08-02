/*
 * mbPIT: 店舗の表示名（PitStore.displayName）を変更する。
 *
 * 命名の原則: **slugは英小文字（URL用）／表示名は日本語（人が読む用）**。
 * slugは upsertPitStore が /^[a-z0-9-]+$/ で強制しているが、表示名は自由入力なので、
 * 英語のまま登録されてしまうことがある（例: 「プレジャー」が pleasure のままだった）。
 *
 * 表示名はWPへ同期していない（同期対象は STORE_META_FIELDS の9項目のみ）ため、
 * WP側のカテゴリ名とは独立している。ここを変えてもWPは変わらない。
 *
 * 注意: 表示名は投稿時に記事本文の「施工店: ○○」へ**焼き込まれる**。
 * 変更しても過去記事は変わらない（過去記事を書き換える機能はあえて作っていない。
 * 記事は施工時点の記録なので、後から一括で書き換えるべきものではない）。
 *
 * 安全のための決めごと:
 * - **既定はドライラン**。`--commit` を付けたときだけ書き込む
 * - 対象は slug で指定する（表示名で探すと、まさに直したい表記ゆれで引けない）
 * - slug は変更しない。displayName の1列だけ触る
 *
 * 実行（本番コンテナ内）:
 *   npx tsx scripts/pit-set-store-name.mts --slug=pleasure --name=プレジャー
 *   npx tsx scripts/pit-set-store-name.mts --slug=pleasure --name=プレジャー --commit
 *
 * 名前に空白や記号が入る場合は base64 でも渡せる（シェルの引用符事故を避けるため）:
 *   npx tsx scripts/pit-set-store-name.mts --slug=pleasure --name-b64=44OX44Os44K444Oj44O8
 */

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL が必要（本番コンテナ内で実行する前提）。");
  process.exit(2);
}

const argv = process.argv.slice(2);
const commit = argv.includes("--commit");
const arg = (k: string): string => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : "";
};

const slug = arg("slug").trim();
const nameB64 = arg("name-b64").trim();
const name = (nameB64 ? Buffer.from(nameB64, "base64").toString("utf-8") : arg("name")).trim();

if (!slug || !name) {
  console.error("使い方: --slug=<店舗slug> --name=<新しい表示名> [--commit]");
  process.exit(2);
}
if (name.length > 60) {
  console.error("表示名が長すぎます（60文字まで）。");
  process.exit(2);
}

const { PrismaClient } = (await import("../src/generated/prisma/client")) as {
  PrismaClient: new (o: unknown) => unknown;
};
const { PrismaPg } = (await import("@prisma/adapter-pg")) as { PrismaPg: new (s: string) => unknown };

type Store = { id: string; displayName: string; slug: string; wpCategoryId: number };

const adapter = new PrismaPg(process.env.DATABASE_URL);
const prisma = new PrismaClient({ adapter }) as {
  pitStore: {
    findUnique: (a: unknown) => Promise<Store | null>;
    update: (a: unknown) => Promise<unknown>;
  };
  pitPost: { count: (a: unknown) => Promise<number> };
  $disconnect: () => Promise<void>;
};

console.log(commit ? "== 店舗表示名の変更（書き込み） ==" : "== 店舗表示名の変更（ドライラン・書き込みなし） ==");

const store = await prisma.pitStore.findUnique({
  where: { slug },
  select: { id: true, displayName: true, slug: true, wpCategoryId: true },
});
if (!store) {
  console.error(`slug「${slug}」の店舗が見つかりません。`);
  await prisma.$disconnect();
  process.exit(1);
}

console.log(`対象: slug=${store.slug} WPカテゴリ=${store.wpCategoryId}`);
console.log(`  表示名 「${store.displayName}」 → 「${name}」`);

if (store.displayName === name) {
  console.log("  = 既にその表示名です。変更しません。");
  await prisma.$disconnect();
  process.exit(0);
}

// 過去記事には旧名が焼き込まれている。件数を出して、影響範囲を隠さない
const baked = await prisma.pitPost.count({
  where: { storeId: store.id, wpPostId: { not: null } },
});
if (baked) {
  console.log(`  ※ 公開済み記事 ${baked}件の本文には旧名「${store.displayName}」が焼き込まれています。`);
  console.log(`     これらは変更されません（記事は施工時点の記録のため）。`);
}
console.log("  ※ WordPress側のカテゴリ名は変わりません（表示名は同期対象外）。");

if (commit) {
  await prisma.pitStore.update({ where: { id: store.id }, data: { displayName: name } });
  console.log("  ✅ 変更しました");
} else {
  console.log("");
  console.log("書き込むには --commit を付けて実行してください。");
}

await prisma.$disconnect();
