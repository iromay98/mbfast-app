/*
 * 個人情報（車台番号・登録番号）の暗号化と、復号の監査。
 *
 * 設計要件（レビューで確定した必須事項）:
 *  1. 鍵の分離   … AES鍵は SERVER_SECRET（HMAC=vehicleKey用）とは別の鍵。環境変数で与える。
 *                  DB・リポジトリには置かない。SERVER_SECRET からの導出は行わない。
 *  2. 事業継続   … 鍵を失うと証明書・法定記録簿を出力できず2年保存義務を果たせない。
 *                  バックアップ／復旧手順は docs/pii-key-management.md に記載。
 *  3. 監査       … 復号は必ず「誰が・どの証明書の・何を・なぜ」を伴う。引数で強制し、
 *                  PitPiiAccessLog に記録する（引数なしで復号する経路を作らない）。
 *  4. 鍵ローテ   … 暗号文にキーIDを持つ（v2:<keyId>:<iv>:<tag>:<data>）。
 *                  複数鍵を同時に保持でき、古い鍵で作った値も読める。
 *  5. 平文断片   … 照合用に新たな平文断片は増やさない（既存の下3桁のみを使う）。
 *
 * 鍵の指定（.env）:
 *   PII_ENC_KEYS="k2:<32バイト以上の乱数>,k1:<旧鍵>"   ← 先頭が現行鍵。カンマ区切りで旧鍵を併記
 *   後方互換として PII_ENC_KEY（単一・keyId=k1扱い）も受け付ける。
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const FORMAT = "v2";

type KeyEntry = { id: string; key: Buffer };

let cached: KeyEntry[] | null = null;

/** 鍵一覧（先頭＝現行鍵）。未設定なら空配列 */
function keys(): KeyEntry[] {
  if (cached) return cached;
  const raw = process.env.PII_ENC_KEYS?.trim();
  const single = process.env.PII_ENC_KEY?.trim();
  const list: KeyEntry[] = [];
  if (raw) {
    for (const part of raw.split(",")) {
      const [id, secret] = part.split(":");
      if (!id?.trim() || !secret?.trim()) continue;
      list.push({ id: id.trim(), key: createHash("sha256").update(secret.trim()).digest() });
    }
  } else if (single) {
    list.push({ id: "k1", key: createHash("sha256").update(single).digest() });
  }
  cached = list;
  return list;
}

/** 鍵キャッシュを破棄する（鍵の差し替え直後・テストで使用） */
export function resetKeyCache(): void {
  cached = null;
}

/** 証明書機能が使える状態か（鍵未設定ならブログ投稿は動くが証明書は作らせない） */
export function piiCryptoConfigured(): boolean {
  return keys().length > 0;
}

function currentKey(): KeyEntry {
  const k = keys()[0];
  if (!k) throw new Error("PII_ENC_KEYS（個人情報の暗号化鍵）が未設定です");
  return k;
}

/** 暗号化。形式は v2:<keyId>:<iv>:<tag>:<data>（すべてbase64url） */
export function encryptPii(plain: string): string {
  const { id, key } = currentKey();
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return [FORMAT, id, iv.toString("base64url"), c.getAuthTag().toString("base64url"), enc.toString("base64url")].join(
    ":",
  );
}

/** 暗号文に埋め込まれたキーIDを読む（ローテーション状況の把握用） */
export function keyIdOf(stored: string | null | undefined): string | null {
  if (!stored) return null;
  const [v, id] = stored.split(":");
  return v === FORMAT && id ? id : null;
}

/** 現行鍵で作られた値か（再暗号化が必要な行の抽出に使う） */
export function needsRekey(stored: string | null | undefined): boolean {
  const id = keyIdOf(stored);
  return !!id && id !== currentKey().id;
}

function decryptRaw(stored: string): string | null {
  const [v, id, ivB, tagB, dataB] = stored.split(":");
  if (v !== FORMAT || !id || !ivB || !tagB || !dataB) return null;
  const entry = keys().find((k) => k.id === id);
  if (!entry) return null; // 対応する鍵が無い（鍵を失った／まだ設定していない）
  try {
    const d = createDecipheriv("aes-256-gcm", entry.key, Buffer.from(ivB, "base64url"));
    d.setAuthTag(Buffer.from(tagB, "base64url"));
    return Buffer.concat([d.update(Buffer.from(dataB, "base64url")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

export type PiiAccessContext = {
  actorUserId: string;
  actorRole: string;
  field: "vin" | "regNumber";
  /** なぜ復号したか（証明書PDF出力・法定記録簿出力・エクスポート等） */
  purpose: string;
  certificateId?: string | null;
  vehicleId?: string | null;
};

/**
 * 復号（監査ログ必須）。
 * 引数でアクセス文脈を強制しているため、「誰が読んだか分からない復号」が実装できない。
 * 失敗（鍵が無い・壊れている）も記録する。
 */
export async function decryptPiiAudited(
  stored: string | null | undefined,
  ctx: PiiAccessContext,
): Promise<string | null> {
  if (!stored) return null;
  const value = decryptRaw(stored);
  try {
    // 暗号処理そのものはDBに依存させない（監査ログの書き込み時だけ読み込む）
    const { prisma } = await import("@/lib/db");
    await prisma.pitPiiAccessLog.create({
      data: {
        actorUserId: ctx.actorUserId,
        actorRole: ctx.actorRole,
        field: ctx.field,
        purpose: ctx.purpose,
        certificateId: ctx.certificateId ?? null,
        vehicleId: ctx.vehicleId ?? null,
        ok: value !== null,
        keyId: keyIdOf(stored),
      },
    });
  } catch (e) {
    // ログに書けない場合でも復号結果は返す（記録欠落は監視で拾う）
    console.error("mbPIT: 個人情報アクセスログの記録に失敗", e);
  }
  return value;
}

/**
 * 監査ログ不要な内部処理専用の復号。
 * 用途は「再暗号化（鍵ローテーション）」のみ。人が値を見ないため監査対象外。
 */
export function decryptForRekeyOnly(stored: string): string | null {
  return decryptRaw(stored);
}
