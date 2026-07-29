/*
 * 車台番号・登録番号の暗号化（AES-256-GCM）。
 *
 * 背景と設計判断:
 * 既存のmbPITは「車台番号を平文でDBに保存しない」方針で、HMAC(vehicleKey)と下3桁のみを
 * 持っている。一方で法定記録簿と施工証明書には車台番号・登録番号を印字する必要があるため、
 * 平文保存に切り替えるのではなく「暗号化して保存し、証明書/記録簿の出力時だけ復号する」形にした。
 *
 * - 車両の一意キーは従来どおり vehicleKey（HMAC）。この関係は変えない
 * - 復号できるのはこのモジュールを import した箇所のみ。公開ブログ生成
 *   （src/server/pit/generate.ts / pipeline.ts）は import しない＝構造的に平文へ到達できない
 * - 鍵は PII_ENC_KEY（32バイト以上の任意文字列）から導出。未設定なら SERVER_SECRET から
 *   別ラベルで導出する（新しい環境変数を必須にしないため）
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const VERSION = "v1";

function key(): Buffer {
  const src = process.env.PII_ENC_KEY || process.env.SERVER_SECRET;
  if (!src) throw new Error("PII_ENC_KEY または SERVER_SECRET が未設定です");
  // ラベルを混ぜて他用途（vehicleKeyのHMAC等）と鍵が一致しないようにする
  return createHash("sha256").update(`mbpit.pii.${VERSION}:${src}`).digest();
}

/** 暗号化して "v1:iv:tag:ciphertext"（base64url）を返す */
export function encryptPii(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key(), iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [VERSION, iv.toString("base64url"), c.getAuthTag().toString("base64url"), enc.toString("base64url")].join(":");
}

/**
 * 復号。壊れた値・鍵違いの場合は null を返す（例外で画面を落とさない）。
 * 証明書・法定記録簿の出力経路からのみ呼ぶこと。
 */
export function decryptPii(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const [v, ivB, tagB, dataB] = stored.split(":");
  if (v !== VERSION || !ivB || !tagB || !dataB) return null;
  try {
    const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB, "base64url"));
    d.setAuthTag(Buffer.from(tagB, "base64url"));
    return Buffer.concat([d.update(Buffer.from(dataB, "base64url")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/** 表示用のマスク（例: ZC33S-123456 → ZC33S-****56）。共有ページの照合表示などに使う */
export function maskVin(vin: string): string {
  if (vin.length <= 4) return "*".repeat(vin.length);
  return vin.slice(0, Math.max(1, vin.length - 6)).padEnd(vin.length - 2, "*") + vin.slice(-2);
}
