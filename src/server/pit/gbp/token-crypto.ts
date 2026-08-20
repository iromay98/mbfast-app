/*
 * 加盟店のGoogleリフレッシュトークンの暗号化。
 *
 * 方式B（加盟店が自分でGoogleログインして自店を選ぶ）では、店舗ごとの
 * リフレッシュトークンを預かることになる。**このトークンがあれば、その店の
 * Googleビジネスプロフィールを操作できてしまう**。平文で持たない。
 *
 * 設計は pii-crypto.ts に合わせるが、鍵は分ける:
 *  - PII_ENC_KEYS … 車台番号など個人情報（復号は監査つき）
 *  - GBP_TOKEN_ENC_KEYS … 本ファイル（復号は投稿処理が随時行うため監査を課さない）
 * 用途が違えば鍵も分ける（片方の漏洩をもう片方に波及させない）。docs/pii-key-management.md の原則。
 *
 * 鍵の指定（.env）:
 *   GBP_TOKEN_ENC_KEYS="k2:<32バイト以上の乱数>,k1:<旧鍵>"   ← 先頭が現行鍵
 *
 * 鍵を失った場合は復旧不能だが、事業継続は止まらない。各加盟店に
 * 再連携（再ログイン）してもらえば復旧できる。個人情報の鍵とは重大性が異なる。
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const FORMAT = "v1";

type KeyEntry = { id: string; key: Buffer };

let cached: KeyEntry[] | null = null;

function keys(): KeyEntry[] {
  if (cached) return cached;
  const raw = process.env.GBP_TOKEN_ENC_KEYS?.trim();
  const list: KeyEntry[] = [];
  if (raw) {
    for (const part of raw.split(",")) {
      const [id, secret] = part.split(":");
      if (!id?.trim() || !secret?.trim()) continue;
      list.push({ id: id.trim(), key: createHash("sha256").update(secret.trim()).digest() });
    }
  }
  cached = list;
  return list;
}

/** 鍵キャッシュを破棄する（鍵の差し替え直後・テストで使用） */
export function resetTokenKeyCache(): void {
  cached = null;
}

/** 加盟店の自己連携（方式B）が使える状態か。未設定なら連携ボタンを出さない */
export function tokenCryptoConfigured(): boolean {
  return keys().length > 0;
}

function currentKey(): KeyEntry {
  const k = keys()[0];
  if (!k) throw new Error("GBP_TOKEN_ENC_KEYS（加盟店トークンの暗号化鍵）が未設定です");
  return k;
}

/** 暗号化。形式は v1:<keyId>:<iv>:<tag>:<data>（すべてbase64url） */
export function encryptToken(plain: string): string {
  const { id, key } = currentKey();
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [FORMAT, id, iv.toString("base64url"), c.getAuthTag().toString("base64url"), enc.toString("base64url")].join(
    ":",
  );
}

/**
 * 復号。読めなければ null（鍵の入れ替え漏れ・改ざん）。
 * 呼び出し側は null を「再連携が必要」として扱うこと（例外にして投稿全体を止めない）。
 */
export function decryptToken(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const parts = stored.split(":");
  if (parts.length !== 5 || parts[0] !== FORMAT) return null;
  const [, keyId, iv, tag, data] = parts;
  const entry = keys().find((k) => k.id === keyId);
  if (!entry) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", entry.key, Buffer.from(iv, "base64url"));
    d.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([d.update(Buffer.from(data, "base64url")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** 暗号文に埋め込まれたキーIDを読む（ローテーション状況の把握用） */
export function tokenKeyIdOf(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const parts = stored.split(":");
  return parts.length === 5 && parts[0] === FORMAT ? (parts[1] ?? null) : null;
}
