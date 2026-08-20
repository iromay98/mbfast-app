/*
 * Googleマップへの投稿を実地で確かめる（本店で1件だけ）。
 *
 *   npm run gbp:testpost -- --dry                    … 送信せず本文だけ表示
 *   npm run gbp:testpost -- --location 18204209748554497603
 *   npm run gbp:testpost -- --location 1820... --go  … 実際に投稿する
 *   npm run gbp:testpost -- --delete accounts/x/locations/y/localPosts/z
 *
 * 重要:
 * - GBPの投稿は**作成後に編集できない**。直すには消して作り直すしかないので、
 *   既定は --dry（送信しない）。実投稿は --go を明示したときだけ。
 * - 作成は1日あたりの上限を消費する。連打しないこと。
 * - 投稿は**実際にGoogleマップに公開される**。本文は必ず目視してから送る。
 */

import {
  createLocalPost,
  deleteLocalPost,
  listLocalPosts,
  configuredAccountId,
  GbpError,
  gbpConfigured,
  LOCAL_POST_SUMMARY_MAX,
  type LocalPostDraft,
} from "../src/server/pit/gbp/client";

const args = process.argv.slice(2);
const has = (f: string) => args.includes(f);
const val = (f: string) => {
  const i = args.indexOf(f);
  return i >= 0 ? args[i + 1] : undefined;
};

/* 本店（渋谷）の施工記録を想定した文面。
 * 一覧では先頭80〜100字ほどしか読まれないため、車種と作業内容を先頭に置く。 */
const DRAFT: LocalPostDraft = {
  summary: [
    "【施工記録】BMW X5M Competition／ECUチューニング＋バブリング施工",
    "",
    "アクラポビッチ装着車のコールドスタート音を抑えつつ、アイドリングストップの解除まで対応しました。",
    "純正データは施工前に保存しているため、いつでも元の状態に戻せます。",
    "",
    "作業の詳細は施工記録ページでご覧いただけます。",
  ].join("\n"),
  cta: {
    type: "LEARN_MORE",
    url: "https://mbfasttuning.com/mbpit/mbfast-tuning/bmw-x5m-competition-ecu-tuning-20260808/",
  },
};

function show(d: LocalPostDraft) {
  console.log("─".repeat(60));
  console.log(d.summary);
  console.log("─".repeat(60));
  console.log(`本文 ${d.summary.length} 字 / 上限 ${LOCAL_POST_SUMMARY_MAX} 字`);
  console.log(`先頭100字（一覧で読まれる範囲）:\n  ${d.summary.slice(0, 100).replace(/\n/g, " ")}`);
  if (d.cta) console.log(`ボタン: ${d.cta.type} → ${d.cta.url ?? "(URLなし)"}`);
  if (d.photoUrl) console.log(`写真: ${d.photoUrl}`);
}

async function main() {
  const cfg = gbpConfigured();
  if (!cfg.ok) {
    console.error(`設定が足りません: ${cfg.missing.join(", ")}`);
    process.exit(1);
  }

  const del = val("--delete");
  if (del) {
    await deleteLocalPost(del);
    console.log(`削除しました: ${del}`);
    return;
  }

  show(DRAFT);

  if (!has("--go")) {
    console.log("\n--dry（既定）のため送信していません。実際に投稿するには --go を付けてください。");
    return;
  }

  const accountId = configuredAccountId();
  if (!accountId) {
    console.error("GBP_ACCOUNT_ID が未設定です");
    process.exit(1);
  }
  const locationId = val("--location");
  if (!locationId) {
    console.error("--location でロケーションIDを指定してください（例: 18204209748554497603）");
    process.exit(1);
  }

  console.log(`\n投稿します: ${accountId} / locations/${locationId.replace(/^locations\//, "")}`);
  try {
    const post = await createLocalPost(accountId, locationId, DRAFT);
    console.log("投稿しました。");
    console.log(`  name      : ${post.name}`);
    console.log(`  state     : ${post.state ?? "-"}`);
    console.log(`  searchUrl : ${post.searchUrl ?? "-"}`);
    console.log("\n取り消すには:");
    console.log(`  npm run gbp:testpost -- --delete ${post.name}`);

    const { posts } = await listLocalPosts(accountId, locationId, 1);
    console.log(`\n一覧で確認: ${posts[0]?.name ?? "(取得できず)"} / ${posts[0]?.state ?? "-"}`);
  } catch (e) {
    if (e instanceof GbpError) {
      console.error(`失敗しました（${e.kind}）: ${e.message}`);
      if (e.kind === "quota") console.error("  1日の作成上限に達している可能性があります。");
      if (e.kind === "permission") console.error("  このロケーションへの投稿権限が無い可能性があります。");
      process.exit(1);
    }
    throw e;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
