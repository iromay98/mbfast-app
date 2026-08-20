/*
 * 方式B（加盟店の自己連携）の安全性を検査する。ネットワーク非依存。
 *
 *   npm run check:gbp-self
 *
 * ここが破られると「他店のGoogleマップに投稿する」事故に直結するため、
 * state署名とトークン暗号化は必ず自動で確かめる。
 */
process.env.SERVER_SECRET ??= "check-only-secret";
process.env.GBP_TOKEN_ENC_KEYS ??= "k1:" + "c".repeat(48);

import { signState, verifyState } from "../src/server/pit/gbp/self-auth";
import { decryptToken, encryptToken, tokenKeyIdOf } from "../src/server/pit/gbp/token-crypto";

let ng = 0;
const t = (ok: boolean, label: string) => {
  console.log(`  ${ok ? "OK" : "NG"}  ${label}`);
  if (!ok) ng++;
};

const s = signState("store_abc");
t(verifyState(s)?.storeId === "store_abc", "正しいstateからstoreIdが取れる");
t(verifyState(s.slice(0, -2) + "xx") === null, "署名の改ざんを弾く");
t(
  verifyState(Buffer.from("store_OTHER." + Date.now()).toString("base64url") + "." + s.split(".")[1]) === null,
  "storeIdの差し替えを弾く（他店への紐付け防止）",
);
t(verifyState(signState("x", Date.now() - 11 * 60_000)) === null, "10分超で失効する");
t(verifyState("") === null && verifyState("garbage") === null, "壊れた値を弾く");

const tok = "1//0abcDEF_refresh-token-example";
const enc = encryptToken(tok);
t(!enc.includes(tok), "暗号文に平文が含まれない");
t(decryptToken(enc) === tok, "復号できる");
t(tokenKeyIdOf(enc) === "k1", "キーIDを取り出せる");
t(decryptToken(enc.slice(0, -3) + "zzz") === null, "改ざんを検知してnullを返す（例外にしない）");
t(decryptToken(null) === null && decryptToken("v9:x:y:z:w") === null, "不正形式でnull");
t(encryptToken(tok) !== enc, "毎回IVが変わる");

if (ng > 0) {
  console.error(`\n${ng} 件失敗しました。`);
  process.exit(1);
}
console.log("\nすべて通りました。");
