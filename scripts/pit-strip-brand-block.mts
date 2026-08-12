/*
 * mbPIT: 既存のWP記事から旧ブランドブロックを除去する。
 *
 * なぜ必要か: WP側にmbPIT用の見た目が無かった時期、投稿時に本文の先頭へ
 * <style>＋mbpit-topbar の wp:html ブロックを焼き込んでいた（wordpress.ts の旧 BRAND_BLOCK）。
 * ポータル側がmbPIT用テンプレートを整えたため二重表示になり、挿入は廃止した。
 * 既存記事には焼き込まれたまま残っているので、後追いで剥がす。
 *
 * 安全のための決めごと:
 * - **既定はドライラン**。`--commit` を付けたときだけWPに書き込む
 * - 除去するのは「wp:html ブロックで、かつ中に mbpit-topbar を含むもの」だけ。
 *   それ以外の本文・タイトル・状態・カテゴリ・タグには触れない
 * - ブロックが見つからない記事はスキップ（何度流しても同じ結果＝冪等）
 * - 書き込み後に読み戻して、ブロックが消えたこと・他の本文が残っていることを確認する
 *
 * 実行（本番コンテナ内・workflow job=brand から呼ばれる）:
 *   npx tsx scripts/pit-strip-brand-block.mts            # ドライラン
 *   npx tsx scripts/pit-strip-brand-block.mts --commit   # 書き込み
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

if (!wpConfigured()) {
  console.error("WP_USER / WP_APP_PASSWORD が未設定です。WP認証のある環境で実行してください。");
  process.exit(2);
}

type Post = {
  id: string;
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

/*
 * 旧ブランドブロックの検出・除去。
 * wp:html ブロック単位でマッチし、**中身に mbpit-topbar を含むものだけ**除去する
 * （他の wp:html ブロック＝動画埋め込み等を巻き込まない）。
 */
function stripBrandBlock(content: string): { out: string; found: boolean } {
  const re = /<!--\s*wp:html\s*-->[\s\S]*?<!--\s*\/wp:html\s*-->\s*/g;
  let found = false;
  const out = content.replace(re, (block) => {
    if (block.includes("mbpit-topbar")) {
      found = true;
      return "";
    }
    return block;
  });
  return { out: out.replace(/^\s+/, ""), found };
}

console.log(
  commit ? "== 旧ブランドブロック除去（書き込み） ==" : "== 旧ブランドブロック除去（ドライラン・書き込みなし） ==",
);
console.log("");

const posts = await prisma.pitPost.findMany({
  where: { status: { in: ["published", "review"] }, wpPostId: { not: null } },
  select: {
    id: true, status: true, wpPostId: true, title: true, vehicle: true,
    store: { select: { displayName: true } },
  },
  orderBy: { createdAt: "asc" },
});

console.log(`対象候補: ${posts.length}件（公開済み＋確認待ち下書き）`);
console.log("");

let stripped = 0;
let clean = 0;
let failed = 0;

for (const p of posts) {
  const wpId = p.wpPostId as number;
  const label = `WP:${wpId} [${p.status}] ${p.store.displayName} / ${p.title ?? p.vehicle}`;
  try {
    const cur = await fetchPostContent(wpId);
    const { out, found } = stripBrandBlock(cur.contentRaw);
    if (!found) {
      console.log(`  =  ${label} ブロックなし（対応不要）`);
      clean++;
      continue;
    }
    if (!commit) {
      console.log(`  +  ${label} → 除去予定（本文 ${cur.contentRaw.length}→${out.length}文字）`);
      stripped++;
      continue;
    }
    if (out.trim().length === 0) {
      // 本文が空になるのは異常（ブロックしか無い記事は存在しないはず）。触らない
      console.error(`  ❌ ${label} 除去すると本文が空になるためスキップ（要確認）`);
      failed++;
      continue;
    }
    await updatePost(wpId, { content: out });
    // 読み戻し検証: ブロックが消えて、本文がちゃんと残っているか
    const after = await fetchPostContent(wpId);
    if (after.contentRaw.includes("mbpit-topbar") || after.contentRaw.trim().length === 0) {
      console.error(`  ❌ ${label} 書き込み後の検証に失敗（本文を確認してください）`);
      failed++;
      continue;
    }
    console.log(`  ✅ ${label} → 除去（本文 ${cur.contentRaw.length}→${after.contentRaw.length}文字）`);
    stripped++;
  } catch (e) {
    console.error(`  ❌ ${label} 失敗: ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }
}

console.log("");
console.log(
  `${commit ? "除去" : "除去予定"} ${stripped} / ブロックなし ${clean} / 失敗 ${failed}`,
);
if (!commit) console.log("書き込むには --commit を付けて実行してください。");

await prisma.$disconnect();
if (failed) process.exit(1);
