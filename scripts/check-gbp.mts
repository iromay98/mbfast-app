/*
 * Googleビジネスプロフィール連携の検証（ネットワーク不要）。
 *
 *   npm run check:gbp
 *
 * Step 1 の範囲では「秘密が外に出ないこと」と「設定漏れを黙って進めないこと」を見る。
 * Step 3 以降で投稿ペイロードの公開/非公開検査をここに足していく。
 */
import { readFileSync } from "node:fs";
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

console.log("[4] 紐付けの作法（ソース確認）");
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
