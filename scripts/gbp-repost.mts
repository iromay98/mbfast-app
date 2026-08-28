/*
 * Googleマップ投稿のやり直し（失敗した施工記録を後から手動で送る）。
 *
 *   npm run gbp:repost                    … 失敗・未投稿の一覧を表示（送らない）
 *   npm run gbp:repost -- --post <id>     … そのPitPostをマップへ投稿
 *   npm run gbp:repost -- --post <id> --no-photo … 写真なしで投稿
 *
 * 使いどころ: 自動投稿が失敗した記録（gbpError あり）を、原因対処後に送り直す。
 * 二重投稿防止: gbpPostName が既に入っている記録は拒否する（GBPの投稿は
 * 編集できないため、二重に出すと片方を手で消すはめになる）。
 */
import { prisma } from "../src/lib/db";
import { postRecordToMap } from "../src/server/pit/gbp/auto-post";

const args = process.argv.slice(2);
const val = (f: string) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};

async function main() {
  const postId = val("--post");

  if (!postId) {
    const rows = await prisma.pitPost.findMany({
      where: { status: "published", gbpPostName: null },
      orderBy: { createdAt: "desc" },
      take: 15,
      select: {
        id: true,
        title: true,
        gbpError: true,
        publishedUrl: true,
        store: { select: { displayName: true, gbpPostingEnabled: true, gbpLocationId: true } },
      },
    });
    console.log("マップ未投稿の公開記録（新しい順・15件まで）:");
    for (const r of rows) {
      const linked = r.store.gbpLocationId && r.store.gbpPostingEnabled ? "" : "（店舗が未連携/無効）";
      console.log(`\n  id: ${r.id}`);
      console.log(`     ${r.store.displayName} / ${r.title ?? "(無題)"} ${linked}`);
      if (r.gbpError) console.log(`     前回の失敗: ${r.gbpError}`);
    }
    console.log("\n送るには: npm run gbp:repost -- --post <id>");
    return;
  }

  const post = await prisma.pitPost.findUnique({
    where: { id: postId },
    select: {
      id: true,
      vehicle: true,
      title: true,
      memo: true,
      publishedUrl: true,
      gbpPostName: true,
      status: true,
      storeId: true,
      store: { select: { displayName: true } },
    },
  });
  if (!post) throw new Error("PitPostが見つかりません");
  if (post.gbpPostName) {
    throw new Error(`既にマップ投稿済みです（${post.gbpPostName}）。二重投稿になるため中止します。`);
  }
  if (post.status !== "published" || !post.publishedUrl) {
    throw new Error(`ブログ公開済みの記録のみ送れます（status=${post.status}）`);
  }

  console.log(`送信: ${post.store.displayName} / ${post.title}`);
  const r = await postRecordToMap({
    storeId: post.storeId,
    storeName: post.store.displayName,
    postId: post.id,
    vehicle: post.vehicle,
    title: post.title ?? post.vehicle,
    memo: post.memo,
    articleUrl: post.publishedUrl,
    // 再投稿はテキストのみを既定にする（写真URL取得失敗が失敗原因の筆頭のため）。
    // 写真を付けたい場合は自動投稿側の経路で次の記録から確認する
    photoUrl: null,
  });
  console.log("結果:", JSON.stringify(r, null, 2));
  if (r.state === "posted") {
    console.log("\nGoogleマップに投稿しました。反映まで数分かかることがあります。");
  }
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
