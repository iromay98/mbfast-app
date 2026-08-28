/*
 * Googleマップ投稿用・写真の署名付きトークン。
 *
 * 背景: GBPの写真は「Googleが公開URLを取りに来る」方式。WordPressの画像URLは
 * XserverのWAFがUA制限で弾き、投稿が "Internal error encountered." で落ちた
 * （2026-08-27 本店マセラティ・写真なし再試行では成功＝原因確定）。
 * そこでアプリ(portal.mbfasttuning.com)から画像を配信し、WAFを迂回する。
 *
 * 公開の絞り方:
 * - ストレージ全体は公開しない。**HMAC署名が付いた特定のキーだけ**配信する
 * - 署名は SERVER_SECRET によるHMAC-SHA256。トークンからキーを改ざんできない
 * - 期限は付けない。GBPは投稿時だけでなく後からも再取得することがあり、
 *   失効させると投稿済みカードの画像が壊れる。漏れても見えるのは
 *   「既にGoogleマップで公開している写真」なので、失うものがない
 * - 対象キーは pit/ 配下（施工記録の処理済み写真）に限定する
 */
import { createHmac, timingSafeEqual } from "node:crypto";

function secret(): string {
  const s = process.env.SERVER_SECRET;
  if (!s) throw new Error("SERVER_SECRET が未設定です");
  return s;
}

function sign(key: string): string {
  return createHmac("sha256", secret()).update(`pit-photo:${key}`).digest("base64url");
}

/** 施工記録の写真キー → 公開URLパス（/api/pit/photo/<token>） */
export function photoToken(key: string): string {
  return `${Buffer.from(key).toString("base64url")}.${sign(key)}`;
}

/** トークン → 検証済みキー。不正なら null */
export function verifyPhotoToken(token: string): string | null {
  const [b64, sig] = (token ?? "").split(".");
  if (!b64 || !sig) return null;
  let key: string;
  try {
    key = Buffer.from(b64, "base64url").toString("utf8");
  } catch {
    return null;
  }
  // 施工記録の写真だけを配信対象にする（他のストレージ領域を署名付きでも出さない）
  if (!key.startsWith("pit/")) return null;
  const expect = Buffer.from(sign(key));
  const got = Buffer.from(sig);
  if (expect.length !== got.length || !timingSafeEqual(expect, got)) return null;
  return key;
}

/** 絶対URL（GBPに渡す値）。AUTH_URL=ポータルの公開オリジン */
export function publicPhotoUrl(key: string): string {
  const base = (process.env.AUTH_URL ?? "https://portal.mbfasttuning.com").replace(/\/+$/, "");
  return `${base}/api/pit/photo/${photoToken(key)}`;
}
