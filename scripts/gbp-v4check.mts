/*
 * v4（Google My Business API）の割り当てが生きているかを確かめる最小のリクエスト。
 *
 *   npm run gbp:v4check                      … GBP_LOCATION_MAP の全ロケーションを確認
 *   npm run gbp:v4check -- 18204209748554497603   … ロケーションIDを直接指定
 *
 * **投稿は作らない**（GET localPosts?pageSize=1 だけ）。
 * localPosts の作成は Create requests per day(=100) を消費するが、一覧は読み取りなので
 * 「投稿できる状態か」を安全に判定できる。
 *
 * 一覧API（Account Management / Business Information）は一切呼ばない。
 * accountId は GBP_ACCOUNT_ID、locationId は引数か GBP_LOCATION_MAP から取る。
 */
import {
  gbpConfigured,
  configuredAccountId,
  configuredLocationMap,
  listLocalPosts,
  accessToken,
  GbpError,
  redact,
} from "../src/server/pit/gbp/client";

const cfg = gbpConfigured();
if (!cfg.ok) {
  console.log("✗ 認証情報が未設定です:", cfg.missing.join(" / "));
  process.exit(1);
}

const accountId = configuredAccountId();
if (!accountId) {
  console.log("✗ GBP_ACCOUNT_ID が未設定です（例: GBP_ACCOUNT_ID=104393726705113377120）");
  process.exit(1);
}

// 対象ロケーション: 引数優先、無ければ GBP_LOCATION_MAP の全件
const args = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const map = configuredLocationMap();
const targets: { label: string; locationId: string }[] = args.length
  ? args.map((a) => ({ label: "（引数）", locationId: `locations/${a.replace(/^locations\//, "")}` }))
  : [...map.entries()].map(([label, locationId]) => ({ label, locationId }));

if (targets.length === 0) {
  console.log("✗ 確認するロケーションがありません");
  console.log("  GBP_LOCATION_MAP=\"slug:18204209748554497603,slug2:1600847083813484494\" を設定するか、");
  console.log("  引数でロケーションIDを渡してください: npm run gbp:v4check -- 18204209748554497603");
  process.exit(1);
}

function dump(label: string, e: unknown): void {
  console.log(`✗ ${label}`);
  if (!(e instanceof GbpError)) {
    console.log(`   ${redact(String(e))}`);
    return;
  }
  console.log(`   kind          : ${e.kind}`);
  console.log(`   HTTP status   : ${e.status ?? "(なし)"}`);
  console.log(`   error.status  : ${e.apiStatus ?? "(なし)"}`);
  console.log(`   error.message : ${e.apiMessage ?? e.message}`);
  if (e.url) console.log(`   URL           : ${e.url}`);
  for (const d of e.details ?? []) console.log(`   details       : ${d}`);
  if (e.body) {
    console.log("   --- raw body (redacted) ---");
    console.log(
      e.body
        .split("\n")
        .map((l) => `   ${l}`)
        .join("\n"),
    );
    console.log("   ---------------------------");
  }
}

try {
  await accessToken();
  console.log("✓ アクセストークンの取得: OK");
} catch (e) {
  dump("アクセストークンを取得できませんでした", e);
  process.exit(1);
}

console.log(`■ account: ${accountId}（一覧APIは呼びません）`);
let failed = 0;
for (const t of targets) {
  console.log("");
  console.log(`— ${t.label} ${t.locationId}`);
  try {
    const { posts, nextPageToken } = await listLocalPosts(accountId, t.locationId, 1);
    console.log(`   ✓ localPosts.list: OK（v4の割り当ては有効）`);
    console.log(`     既存の投稿: ${posts.length === 0 ? "0件（このロケーションに投稿履歴なし）" : `${posts.length}件+`}`);
    for (const p of posts) {
      console.log(`     - ${p.name}`);
      console.log(`       state=${p.state ?? "-"} topic=${p.topicType ?? "-"} created=${p.createTime ?? "-"}`);
      if (p.summary) console.log(`       summary=${p.summary.slice(0, 60)}${p.summary.length > 60 ? "…" : ""}`);
    }
    if (nextPageToken) console.log("     （続きあり）");
  } catch (e) {
    failed++;
    dump(`localPosts.list に失敗（mybusiness.googleapis.com / v4）`, e);
    if (e instanceof GbpError && e.kind === "quota") {
      console.log("   → quota_limit_value が 0 なら v4 もアクセス未承認です");
    }
    if (e instanceof GbpError && e.kind === "notfound") {
      console.log("   → accountId と locationId の組み合わせが違う可能性があります");
      console.log("     （そのロケーションがそのアカウント配下にあるか確認してください）");
    }
    if (e instanceof GbpError && e.kind === "permission") {
      console.log("   → このGoogleアカウントがそのロケーションの管理者になっているか確認してください");
    }
  }
}

console.log("");
if (failed > 0) {
  console.log(`❌ ${failed}/${targets.length} 件で失敗しました`);
  process.exit(1);
}
console.log(`✅ ${targets.length}件すべてで localPosts.list が通りました（投稿は作っていません）`);
console.log("   Cloud Console の割り当て画面で、増えたカウンターを確認してください:");
console.log("   My Business API → 'V4 General Requests per minute' が増えていれば読み取り扱いです");
