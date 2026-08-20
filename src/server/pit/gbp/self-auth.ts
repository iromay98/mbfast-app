/*
 * 方式B: 加盟店が自分のGoogleアカウントでログインし、自店のビジネスプロフィールを
 * 自分で選んで連携する。
 *
 * なぜ方式Bを主にするか:
 *   方式A（加盟店が本部を管理者に招待 → 本部が一覧から住所を見比べて紐付け）は、
 *   店が増えるほど本部の手作業が増え、**別の店のGoogleマップに投稿してしまう事故**の
 *   確率が上がる。GBPの投稿は作成後に編集できず消すしかないため、誤配信は取り返しが
 *   つかない。方式Bでは店主が自分のアカウントで自分の店を選ぶので、誤紐付けが原理的に
 *   起きない。
 *
 * 方式Aは残す（gbpAuthMode="HQ"）。オーナー権限を失っている店・Googleログインに
 * 抵抗がある店を取りこぼさないため。
 *
 * 取り扱う秘密:
 *   リフレッシュトークンは**その店のビジネスプロフィールを操作できる鍵**。
 *   必ず暗号化して保存する（token-crypto.ts）。ログにも画面にも出さない。
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { GbpError, redact as redactSecrets } from "@/server/pit/gbp/client";

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";
const SCOPE = "https://www.googleapis.com/auth/business.manage";

/** 連携の入口・戻り先。OAuthのリダイレクトURIはGoogle側の登録と完全一致が必要 */
export function redirectUri(): string {
  const base = (process.env.AUTH_URL ?? "https://portal.mbfasttuning.com").replace(/\/+$/, "");
  return `${base}/api/pit/gbp/oauth/callback`;
}

export function selfAuthConfigured(): { ok: boolean; missing: string[] } {
  const missing: string[] = [];
  if (!process.env.GBP_CLIENT_ID) missing.push("GBP_CLIENT_ID");
  if (!process.env.GBP_CLIENT_SECRET) missing.push("GBP_CLIENT_SECRET");
  if (!process.env.GBP_TOKEN_ENC_KEYS) missing.push("GBP_TOKEN_ENC_KEYS");
  return { ok: missing.length === 0, missing };
}

/*
 * state（CSRF対策）。
 * 「どの店舗の連携か」を署名付きで往復させる。署名が無いと、他人が細工したURLで
 * 別の店舗に自分のGoogleアカウントを結び付けられてしまう。
 */
function stateSecret(): string {
  const s = process.env.SERVER_SECRET;
  if (!s) throw new GbpError("SERVER_SECRET が未設定です", "not_configured");
  return s;
}

export function signState(storeId: string, issuedAt = Date.now()): string {
  const payload = `${storeId}.${issuedAt}`;
  const sig = createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  return `${Buffer.from(payload).toString("base64url")}.${sig}`;
}

/** state を検証して storeId を取り出す。10分で失効 */
export function verifyState(state: string): { storeId: string } | null {
  const [b64, sig] = (state ?? "").split(".");
  if (!b64 || !sig) return null;
  let payload: string;
  try {
    payload = Buffer.from(b64, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const expect = createHmac("sha256", stateSecret()).update(payload).digest("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  const [storeId, issued] = payload.split(".");
  if (!storeId || !issued) return null;
  if (Date.now() - Number(issued) > 10 * 60_000) return null;
  return { storeId };
}

/*
 * 認可画面のURL。
 * access_type=offline + prompt=consent は**リフレッシュトークンを確実に受け取る**ため。
 * これが無いと2回目以降の連携でトークンが返らず、再連携できなくなる。
 */
export function authorizeUrl(storeId: string): string {
  const cfg = selfAuthConfigured();
  if (!cfg.ok) throw new GbpError(`連携の設定が足りません: ${cfg.missing.join(", ")}`, "not_configured");
  const q = new URLSearchParams({
    client_id: process.env.GBP_CLIENT_ID!,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state: signState(storeId),
  });
  return `${AUTH_URL}?${q.toString()}`;
}

export type TokenResult = { refreshToken: string; accessToken: string; expiresIn: number };

/** 認可コードをトークンに交換する */
export async function exchangeCode(code: string): Promise<TokenResult> {
  const body = new URLSearchParams({
    code,
    client_id: process.env.GBP_CLIENT_ID!,
    client_secret: process.env.GBP_CLIENT_SECRET!,
    redirect_uri: redirectUri(),
    grant_type: "authorization_code",
  });
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch (e) {
    throw new GbpError(`Googleに接続できませんでした: ${redactSecrets(String(e))}`, "network");
  }
  const text = await res.text();
  if (!res.ok) {
    throw new GbpError(`連携に失敗しました: ${redactSecrets(text)}`, "auth", {
      status: res.status,
      body: redactSecrets(text),
    });
  }
  const json = JSON.parse(text) as { refresh_token?: string; access_token?: string; expires_in?: number };
  if (!json.refresh_token) {
    // prompt=consent を付けていれば通常は返る。返らない場合は既存の許可が残っている
    throw new GbpError(
      "リフレッシュトークンが返りませんでした。Googleアカウントの「サードパーティ アプリとの連携」から一度アクセス権を削除してから、やり直してください。",
      "auth",
    );
  }
  return {
    refreshToken: json.refresh_token,
    accessToken: json.access_token ?? "",
    expiresIn: json.expires_in ?? 3600,
  };
}

/** 店舗のリフレッシュトークンからアクセストークンを得る（保存はしない・都度取得） */
export async function accessTokenFor(refreshToken: string): Promise<string> {
  const body = new URLSearchParams({
    client_id: process.env.GBP_CLIENT_ID!,
    client_secret: process.env.GBP_CLIENT_SECRET!,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body,
    });
  } catch (e) {
    throw new GbpError(`Googleに接続できませんでした: ${redactSecrets(String(e))}`, "network");
  }
  const text = await res.text();
  if (!res.ok) {
    // invalid_grant = 店側が連携を解除した／パスワード変更等で失効。再連携が必要
    const kind = /invalid_grant|unauthorized/.test(text) ? "auth" : "http";
    throw new GbpError(`アクセストークンを取得できませんでした: ${redactSecrets(text)}`, kind, {
      status: res.status,
      body: redactSecrets(text),
    });
  }
  const json = JSON.parse(text) as { access_token?: string };
  if (!json.access_token) throw new GbpError("アクセストークンが空でした", "auth");
  return json.access_token;
}

/** 連携解除。Google側の許可も取り消す（DBから消すだけでは相手に権限が残る） */
export async function revokeToken(refreshToken: string): Promise<void> {
  try {
    await fetch(`${REVOKE_URL}?token=${encodeURIComponent(refreshToken)}`, { method: "POST" });
  } catch {
    // 失敗してもDB側の解除は進める（残ったトークンは店側からも取り消せる）
  }
}
