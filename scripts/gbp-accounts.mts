/*
 * Step 1: Googleビジネスプロフィールの接続確認（読み取りのみ・投稿はしない）。
 *
 *   npm run gbp:accounts
 *
 * 出るもの: 管理権限のあるアカウントと、その配下のロケーション（店名・住所）。
 * ここに加盟店の店舗が出てくれば、方式A（mbFASTを管理者に招待）が成立している。
 *
 * 失敗したときは**Googleの生の応答をそのまま出す**（HTTPステータス / error.status /
 * error.message / details）。403 は「API未有効化」「スコープ不足」「割り当てが0」の
 * どれでも返るため、種別の推測だけでは原因を取り違える。秘密は redact() で伏せる。
 */
import {
  gbpConfigured,
  configuredAccountId,
  listAccounts,
  listLocations,
  accessToken,
  GbpError,
  redact,
} from "../src/server/pit/gbp/client";

const cfg = gbpConfigured();
if (!cfg.ok) {
  console.log("✗ 認証情報が未設定です:", cfg.missing.join(" / "));
  console.log("");
  console.log("必要な手順:");
  console.log("  1. Google Cloud (mbfast-tuning) で OAuth クライアント（ウェブアプリ）を作る");
  console.log("     承認済みリダイレクトURI: http://127.0.0.1:53682/callback");
  console.log("  2. npm run gbp:auth で mbfasttuning.com の組織アカウントで認可");
  console.log("  3. 取得した refresh_token を .env と docker-compose.prod.yml の environment に追加");
  console.log("     GBP_CLIENT_ID / GBP_CLIENT_SECRET / GBP_REFRESH_TOKEN");
  process.exit(1);
}

/** 失敗の中身を隠さずに出す */
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

// 0) トークン更新だけ先に確認する（ここで失敗すれば認可の問題と切り分けられる）
try {
  await accessToken();
  console.log("✓ アクセストークンの取得: OK（リフレッシュトークンは有効）");
} catch (e) {
  dump("アクセストークンを取得できませんでした（認可の問題）", e);
  console.log("");
  console.log("→ npm run gbp:auth で再認可し、GBP_REFRESH_TOKEN を更新してください");
  console.log("  （クライアントシークレットを差し替えた場合、旧シークレットで取ったトークンは使えません）");
  process.exit(1);
}

// 1) アカウント一覧（Account Management API）。
//    GBP_ACCOUNT_ID を指定していれば、このAPIを使わずに次へ進む。
const fixed = configuredAccountId();
let accounts;
if (fixed) {
  console.log(`✓ accounts.list は省略（GBP_ACCOUNT_ID=${fixed} を使用）`);
  accounts = [{ name: fixed, accountName: "（環境変数で指定）", type: "-", role: "-" }];
} else {
  try {
    accounts = await listAccounts();
    console.log(`✓ accounts.list: OK（${accounts.length}件）`);
  } catch (e) {
    dump("accounts.list に失敗（mybusinessaccountmanagement.googleapis.com）", e);
    console.log("");
    console.log("原因の見分け方:");
    console.log("  RESOURCE_EXHAUSTED + quota_limit_value: 0");
    console.log("      → 使いすぎではなく、そのAPIへのアクセスがまだ許可されていない状態。");
    console.log("        『割り当ての増加』ではなく Application for Basic API Access を出す。");
    console.log("        承認はプロジェクト単位・API単位（別APIの承認では通らない）。");
    console.log("  PERMISSION_DENIED … API未有効化 / スコープ不足 / このアカウントに管理権限が無い");
    console.log("  UNAUTHENTICATED …… トークンが無効");
    console.log("");
    console.log("回避策: アカウントIDが分かっているなら GBP_ACCOUNT_ID に入れると");
    console.log("        このAPIを呼ばずにロケーション取得・投稿まで進めます。");
    process.exit(1);
  }
}

if (accounts.length === 0) {
  console.log("⚠ 接続はできましたが、管理権限のあるアカウントが0件です");
  console.log("  → 加盟店側で mbFAST のGoogleアカウントを管理者に招待し、承諾されているか確認してください");
  process.exit(1);
}

// 2) ロケーション一覧（Business Information API。別APIなので割り当ても別）
let locations = 0;
let anyLocationError = false;
for (const account of accounts) {
  console.log("");
  console.log(`■ ${account.name}  ${account.accountName}  [${account.type} / ${account.role}]`);
  try {
    const locs = await listLocations(account.name);
    if (locs.length === 0) console.log("   （ロケーションなし）");
    for (const l of locs) {
      locations++;
      console.log(`   - ${l.name}  ${l.title}`);
      console.log(`       住所: ${l.address || "（未設定）"}${l.phone ? ` / ${l.phone}` : ""}`);
    }
  } catch (e) {
    anyLocationError = true;
    dump(`locations.list に失敗（mybusinessbusinessinformation.googleapis.com / ${account.name}）`, e);
  }
}

console.log("");
if (anyLocationError) {
  console.log(`⚠ アカウントは取得できましたが、ロケーション取得で失敗があります（取得できたのは ${locations}件）`);
  process.exit(1);
}
console.log(`✅ アカウント ${accounts.length}件 / ロケーション ${locations}件 を取得しました`);
