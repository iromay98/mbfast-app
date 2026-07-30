/*
 * Googleビジネスプロフィール連携の検証（ネットワーク不要）。
 *
 *   npm run check:gbp
 *
 * Step 1 の範囲では「秘密が外に出ないこと」と「設定漏れを黙って進めないこと」を見る。
 * Step 3 以降で投稿ペイロードの公開/非公開検査をここに足していく。
 */
import { redact, formatAddress, gbpConfigured, GBP_SCOPE } from "../src/server/pit/gbp/client";

let failed = 0;
function ok(cond: boolean, label: string, detail?: string) {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    failed++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

console.log("[1] 秘密の伏せ字（エラー本文をそのまま画面に出しても漏れない）");
const leak =
  'error for client 123456789012-abcdefghijklmnopqrstuvwx.apps.googleusercontent.com secret GOCSPX-abcdefghijklmnop token "1//0abcdefghijklmnopqrstuvwxyz012345" access ya29.a0AfB_byABCDEFGHIJKLMNOP';
const masked = redact(leak);
ok(!masked.includes("GOCSPX-abcdefghijklmnop"), "クライアントシークレットが伏せられる");
ok(!masked.includes("1//0abcdefghijklmnopqrstuvwxyz012345"), "リフレッシュトークンが伏せられる");
ok(!masked.includes("ya29.a0AfB_byABCDEFGHIJKLMNOP"), "アクセストークンが伏せられる");
ok(!masked.includes("123456789012-abcdefghijklmnopqrstuvwx.apps.googleusercontent.com"), "クライアントIDが伏せられる");

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

console.log(failed === 0 ? "\n✅ すべて通過" : `\n❌ ${failed} 件失敗`);
process.exit(failed === 0 ? 0 : 1);
