/*
 * Step 1: Googleビジネスプロフィールの接続確認（読み取りのみ・投稿はしない）。
 *
 *   npm run gbp:accounts
 *
 * 出るもの: 管理権限のあるアカウントと、その配下のロケーション（店名・住所）。
 * ここに加盟店の店舗が出てくれば、方式A（mbFASTを管理者に招待）が成立している。
 *
 * 失敗したときは原因の候補を出して終了コード1で止まる（設定の問題を沈黙させない）。
 */
import { checkGbpConnection, gbpConfigured } from "../src/server/pit/gbp/client";

const cfg = gbpConfigured();
if (!cfg.ok) {
  console.log("✗ 認証情報が未設定です:", cfg.missing.join(" / "));
  console.log("");
  console.log("必要な手順:");
  console.log("  1. Google Cloud (mbfast-tuning) で OAuth クライアント（デスクトップ/ウェブ）を作る");
  console.log("  2. mbFASTのGoogleアカウントで scope=business.manage を access_type=offline / prompt=consent で認可");
  console.log("  3. 取得した refresh_token を .env と docker-compose.prod.yml の environment に追加");
  console.log("     GBP_CLIENT_ID / GBP_CLIENT_SECRET / GBP_REFRESH_TOKEN");
  process.exit(1);
}

const res = await checkGbpConnection();

if (!res.ok) {
  console.log(`✗ 接続できませんでした (${res.kind})`);
  console.log(res.message);
  console.log("");
  const hints: Record<string, string[]> = {
    auth: [
      "リフレッシュトークンが失効しています（パスワード変更・スコープ変更・6ヶ月未使用など）",
      "→ 認可をやり直して GBP_REFRESH_TOKEN を更新してください",
    ],
    permission: [
      "考えられる原因:",
      "  - My Business Account Management API / Business Information API が未有効",
      "  - スコープが business.manage になっていない",
      "  - OAuth同意画面が「外部」で審査未通過（内部にする必要あり）",
      "  - このGoogleアカウントに管理権限のあるプロフィールが無い",
    ],
    quota: ["割り当て超過です。時間をおいて再実行してください"],
    network: ["ネットワーク（またはプロキシ）から Google API に到達できません"],
  };
  for (const line of hints[res.kind] ?? []) console.log(line);
  process.exit(1);
}

if (res.accounts.length === 0) {
  console.log("⚠ 接続はできましたが、管理権限のあるアカウントが0件です");
  console.log("  → 加盟店側で mbFAST のGoogleアカウントを管理者に招待し、承諾されているか確認してください");
  process.exit(1);
}

let locations = 0;
for (const { account, locations: locs } of res.accounts) {
  console.log(`■ ${account.name}  ${account.accountName}  [${account.type} / ${account.role}]`);
  if (locs.length === 0) {
    console.log("   （ロケーションなし）");
  }
  for (const l of locs) {
    locations++;
    console.log(`   - ${l.name}  ${l.title}`);
    console.log(`       住所: ${l.address || "（未設定）"}${l.phone ? ` / ${l.phone}` : ""}`);
  }
}
console.log("");
console.log(`✅ アカウント ${res.accounts.length}件 / ロケーション ${locations}件 を取得しました`);
