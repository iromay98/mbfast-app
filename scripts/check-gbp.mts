/*
 * Googleビジネスプロフィール連携の検証（ネットワーク不要）。
 *
 *   npm run check:gbp
 *
 * Step 1 の範囲では「秘密が外に出ないこと」と「設定漏れを黙って進めないこと」を見る。
 * Step 3 以降で投稿ペイロードの公開/非公開検査をここに足していく。
 */
import { readFileSync } from "node:fs";
import { redact, formatAddress, gbpConfigured, GBP_SCOPE, parseGoogleError } from "../src/server/pit/gbp/client";

let failed = 0;
function ok(cond: boolean, label: string, detail?: string) {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    failed++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("[1] 秘密の伏せ字（エラー本文をそのまま画面に出しても漏れない）");
// 検体は分割して組み立てる（このファイル自体が check:no-secrets に引っかからないように）
const fakeId = "123456789012-abcdefghijklmnopqrstuvwx" + "." + "apps" + ".googleusercontent.com";
const fakeSecret = "GOCSPX" + "-abcdefghijklmnop";
const fakeRefresh = "1" + "//0abcdefghijklmnopqrstuvwxyz012345";
const fakeAccess = "ya" + "29." + "a0AfB_byABCDEFGHIJKLMNOP";
const masked = redact(
  `error for client ${fakeId} secret ${fakeSecret} token "${fakeRefresh}" access ${fakeAccess}`,
);
ok(!masked.includes(fakeSecret), "クライアントシークレットが伏せられる");
ok(!masked.includes(fakeRefresh), "リフレッシュトークンが伏せられる");
ok(!masked.includes(fakeAccess), "アクセストークンが伏せられる");
ok(!masked.includes(fakeId), "クライアントIDが伏せられる");

console.log("[2] 設定の判定");
const before = { ...process.env };
delete process.env.GBP_CLIENT_ID;
delete process.env.GBP_CLIENT_SECRET;
delete process.env.GBP_REFRESH_TOKEN;
const none = gbpConfigured();
ok(!none.ok && none.missing.length === 3, "未設定なら ok=false で不足分を返す");
process.env.GBP_CLIENT_ID = "x";
process.env.GBP_CLIENT_SECRET = "y";
const partial = gbpConfigured();
ok(!partial.ok && partial.missing.join(",") === "GBP_REFRESH_TOKEN", "一部だけでも未設定として扱う");
ok(JSON.stringify(partial).includes("GBP_REFRESH_TOKEN") && !JSON.stringify(partial).includes('"x"'), "判定結果に値そのものを含めない");
Object.assign(process.env, before);

console.log("[3] スコープと住所整形");
ok(GBP_SCOPE === "https://www.googleapis.com/auth/business.manage", "スコープは business.manage のみ");
ok(
  formatAddress({ postalCode: "591-8021", administrativeArea: "大阪府", locality: "堺市北区", addressLines: ["新金岡町1-2-3"] }) ===
    "〒591-8021 大阪府 堺市北区 新金岡町1-2-3",
  "紐付け確認用に住所を組み立てられる",
);
ok(formatAddress(undefined) === "", "住所が無いロケーションでも落ちない");

console.log("[4] Googleのエラー応答を読み解く（原因を推測で潰さない）");
const quotaBody = JSON.stringify({
  error: {
    code: 429,
    message:
      "Quota exceeded for quota metric 'Requests' and limit 'Requests per minute' of service 'mybusinessaccountmanagement.googleapis.com' for consumer 'project_number:123456789012'.",
    status: "RESOURCE_EXHAUSTED",
    details: [
      {
        "@type": "type.googleapis.com/google.rpc.ErrorInfo",
        reason: "RATE_LIMIT_EXCEEDED",
        domain: "googleapis.com",
        metadata: {
          service: "mybusinessaccountmanagement.googleapis.com",
          quota_metric: "mybusinessaccountmanagement.googleapis.com/default_requests",
          quota_limit: "defaultPerMinutePerProject",
          quota_limit_value: "0",
        },
      },
      {
        "@type": "type.googleapis.com/google.rpc.Help",
        links: [{ description: "Request a higher quota limit.", url: "https://cloud.google.com/docs/quota" }],
      },
    ],
  },
});
const q = parseGoogleError(quotaBody);
ok(q.apiStatus === "RESOURCE_EXHAUSTED", "error.status をそのまま取り出す");
ok((q.apiMessage ?? "").includes("Quota exceeded"), "error.message をそのまま取り出す");
ok(q.details.some((d) => d.includes("quota_limit_value: 0")), "割り当ての上限値（0なら未承認）が出る");
ok(q.details.some((d) => d.includes("RATE_LIMIT_EXCEEDED")), "reason が出る");
ok(
  q.details.some((d) => d.includes("service: mybusinessaccountmanagement.googleapis.com")),
  "どのAPIの割り当てかが分かる",
);
const denied = parseGoogleError(
  JSON.stringify({
    error: {
      code: 403,
      message:
        "My Business Account Management API has not been used in project 123456789012 before or it is disabled.",
      status: "PERMISSION_DENIED",
      details: [
        {
          "@type": "type.googleapis.com/google.rpc.ErrorInfo",
          reason: "SERVICE_DISABLED",
          domain: "googleapis.com",
          metadata: { service: "mybusinessaccountmanagement.googleapis.com" },
        },
      ],
    },
  }),
);
ok(denied.apiStatus === "PERMISSION_DENIED", "403でも error.status で区別できる");
ok(denied.details.some((d) => d.includes("SERVICE_DISABLED")), "API未有効化の理由が出る");
ok(parseGoogleError("<html>502</html>").details.length === 0, "JSONでない応答でも落ちない");

const clientSrc = readFileSync(new URL("../src/server/pit/gbp/client.ts", import.meta.url), "utf8");
ok(
  clientSrc.includes("const fixed = configuredAccountId();"),
  "GBP_ACCOUNT_ID があれば accounts.list を呼ばない（割り当てを使わない）",
);
ok(
  /if \(fixed\) \{/.test(clientSrc) && clientSrc.includes("const accounts = await listAccounts();"),
  "指定が無いときだけ accounts.list に落ちる（既定の挙動は変えない）",
);

const accountsScript = readFileSync(new URL("./gbp-accounts.mts", import.meta.url), "utf8");
ok(accountsScript.includes("error.status"), "接続確認スクリプトが error.status を出す");
ok(accountsScript.includes("raw body (redacted)"), "生の応答（伏せ字済み）も出す");
ok(
  accountsScript.includes("mybusinessbusinessinformation.googleapis.com"),
  "どちらのAPIで失敗したかを出す（割り当てはAPIごと）",
);

console.log("[5] 紐付けの作法（ソース確認）");
const link = readFileSync(new URL("../src/server/pit/gbp/link.ts", import.meta.url), "utf8");
// 店名の類似度などで自動的に決める処理を持ち込まないこと（誤配信の元）
ok(
  !/levenshtein|similar|fuzzy|includes\(.*displayName|startsWith\(.*displayName/i.test(link),
  "店名の自動照合を行っていない",
);
ok(link.includes("gbpPostingEnabled: false"), "紐付け直後は投稿を有効にしない");
ok(/NOT: \{ id: input\.storeId \}/.test(link), "同じロケーションの二重割り当てを拒否している");
ok(
  /gbpLocationId: null[\s\S]{0,200}gbpPostingEnabled: false/.test(link),
  "解除すると投稿も無効になる",
);
ok(
  /!s\.active \|\| !s\.gbpPostingEnabled \|\| !s\.gbpLocationId/.test(link),
  "投稿先の判定は 有効店舗＋投稿有効＋紐付け済み の3条件",
);
const actions = readFileSync(new URL("../src/lib/actions/pit-gbp.ts", import.meta.url), "utf8");
ok(
  (actions.match(/requireHQ\(\)/g) ?? []).length >= 3,
  "紐付け・解除・有効化のすべてが本部限定",
);
ok(!/requireDealer/.test(actions), "加盟店からは操作できない");

const schema = readFileSync(new URL("../prisma/schema.prisma", import.meta.url), "utf8");
ok(/gbpLocationId\s+String\?\s+@unique/.test(schema), "gbpLocationId は一意（1ロケーション=1店舗）");
ok(/gbpPostingEnabled Boolean\s+@default\(false\)/.test(schema), "投稿は既定で無効");

console.log(failed === 0 ? "\n✅ すべて通過" : `\n❌ ${failed} 件失敗`);
process.exit(failed === 0 ? 0 : 1);
