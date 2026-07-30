/*
 * Google ビジネスプロフィール（GBP）APIの最小クライアント。
 *
 * 方式A: 認可するGoogleアカウントは mbFAST の1つだけ。加盟店は自店のプロフィールに
 * mbFAST を管理者として招待する。よって加盟店ごとのOAuthは持たない。
 *
 * 認証情報は必ず環境変数から読む（リポジトリに置かない・ログに出さない）:
 *   GBP_CLIENT_ID / GBP_CLIENT_SECRET / GBP_REFRESH_TOKEN
 *
 * 投稿(localPosts)は v4.9 にしか無いためホストが分かれる:
 *   一覧取得   : mybusinessaccountmanagement / mybusinessbusinessinformation (v1)
 *   投稿の作成 : mybusiness.googleapis.com/v4
 */

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ACCOUNTS_HOST = "https://mybusinessaccountmanagement.googleapis.com/v1";
const INFO_HOST = "https://mybusinessbusinessinformation.googleapis.com/v1";
export const V4_HOST = "https://mybusiness.googleapis.com/v4";
export const GBP_SCOPE = "https://www.googleapis.com/auth/business.manage";

export type GbpConfig = { clientId: string; clientSecret: string; refreshToken: string };

/** 設定の有無だけを返す（値は返さない・出さない） */
export function gbpConfigured(): { ok: boolean; missing: string[] } {
  const missing = (["GBP_CLIENT_ID", "GBP_CLIENT_SECRET", "GBP_REFRESH_TOKEN"] as const).filter(
    (k) => !(process.env[k] ?? "").trim(),
  );
  return { ok: missing.length === 0, missing: [...missing] };
}

function readConfig(): GbpConfig {
  const { ok, missing } = gbpConfigured();
  if (!ok) {
    throw new GbpError(
      `Googleビジネスプロフィールの認証情報が未設定です（${missing.join(" / ")}）`,
      "not_configured",
    );
  }
  return {
    clientId: process.env.GBP_CLIENT_ID!.trim(),
    clientSecret: process.env.GBP_CLIENT_SECRET!.trim(),
    refreshToken: process.env.GBP_REFRESH_TOKEN!.trim(),
  };
}

export type GbpErrorKind =
  | "not_configured"
  | "auth" // リフレッシュトークンが無効・失効
  | "permission" // PERMISSION_DENIED / API未有効化 / スコープ不足
  | "quota" // 429 / RESOURCE_EXHAUSTED
  | "notfound"
  | "http"
  | "network";

export class GbpError extends Error {
  kind: GbpErrorKind;
  status?: number;
  constructor(message: string, kind: GbpErrorKind, status?: number) {
    super(message);
    this.name = "GbpError";
    this.kind = kind;
    this.status = status;
  }
}

/*
 * 秘密が混ざりうる文字列からトークンらしき値を落とす。
 * Googleのエラーレスポンスにはリクエスト内容が含まれることがあるため、
 * 画面・ログに出す前に必ず通す。
 */
export function redact(text: string): string {
  return text
    .replace(/ya29\.[\w.\-]+/g, "[access_token]")
    .replace(/1\/\/[\w.\-]{20,}/g, "[refresh_token]")
    .replace(/[\w-]{24}\.apps\.googleusercontent\.com/g, "[client_id]")
    .replace(/GOCSPX-[\w-]+/g, "[client_secret]");
}

// アクセストークンは短命なのでメモリにだけ持つ（DBにも書かない）
let cached: { token: string; expiresAt: number } | null = null;

export async function accessToken(): Promise<string> {
  if (cached && cached.expiresAt - 60_000 > Date.now()) return cached.token;
  const cfg = readConfig();
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    refresh_token: cfg.refreshToken,
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
    throw new GbpError(`Googleに接続できませんでした: ${redact(String(e))}`, "network");
  }
  const text = await res.text();
  if (!res.ok) {
    // invalid_grant = リフレッシュトークンが失効（再認可が必要）
    const kind: GbpErrorKind = /invalid_grant|invalid_client|unauthorized/.test(text) ? "auth" : "http";
    throw new GbpError(`アクセストークンを取得できませんでした: ${redact(text)}`, kind, res.status);
  }
  const json = JSON.parse(text) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new GbpError("アクセストークンが空でした", "auth", res.status);
  cached = { token: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
  return cached.token;
}

/** テスト・検証用にトークンキャッシュを捨てる */
export function resetTokenCache(): void {
  cached = null;
}

export async function gbpFetch<T>(
  url: string,
  init?: { method?: string; body?: unknown },
): Promise<T> {
  const token = await accessToken();
  let res: Response;
  try {
    res = await fetch(url, {
      method: init?.method ?? "GET",
      headers: {
        authorization: `Bearer ${token}`,
        ...(init?.body ? { "content-type": "application/json" } : {}),
      },
      body: init?.body ? JSON.stringify(init.body) : undefined,
    });
  } catch (e) {
    throw new GbpError(`Googleに接続できませんでした: ${redact(String(e))}`, "network");
  }
  const text = await res.text();
  if (!res.ok) throw new GbpError(redact(text) || `HTTP ${res.status}`, kindOf(res.status, text), res.status);
  return (text ? JSON.parse(text) : {}) as T;
}

function kindOf(status: number, body: string): GbpErrorKind {
  if (status === 401) return "auth";
  if (status === 403) return /RESOURCE_EXHAUSTED|quota/i.test(body) ? "quota" : "permission";
  if (status === 404) return "notfound";
  if (status === 429) return "quota";
  return "http";
}

// ── 一覧取得（Step 1） ──────────────────────────────────────

export type GbpAccount = {
  /** "accounts/1234567890" */
  name: string;
  accountName: string;
  type: string;
  role: string;
  verificationState?: string;
};

export type GbpLocation = {
  /** "locations/1234567890"（v1）。v4の投稿では accounts/{a}/locations/{l} を組む */
  name: string;
  title: string;
  storeCode?: string;
  address: string;
  phone?: string;
  mapsUri?: string;
};

export async function listAccounts(): Promise<GbpAccount[]> {
  const out: GbpAccount[] = [];
  let pageToken: string | undefined;
  do {
    const q = new URLSearchParams({ pageSize: "20", ...(pageToken ? { pageToken } : {}) });
    const json = await gbpFetch<{ accounts?: GbpAccount[]; nextPageToken?: string }>(
      `${ACCOUNTS_HOST}/accounts?${q}`,
    );
    out.push(...(json.accounts ?? []));
    pageToken = json.nextPageToken;
  } while (pageToken);
  return out;
}

type RawLocation = {
  name: string;
  title?: string;
  storeCode?: string;
  phoneNumbers?: { primaryPhone?: string };
  storefrontAddress?: {
    postalCode?: string;
    administrativeArea?: string;
    locality?: string;
    addressLines?: string[];
  };
  metadata?: { mapsUri?: string };
};

export function formatAddress(a: RawLocation["storefrontAddress"]): string {
  if (!a) return "";
  return [a.postalCode ? `〒${a.postalCode}` : "", a.administrativeArea, a.locality, ...(a.addressLines ?? [])]
    .filter(Boolean)
    .join(" ")
    .trim();
}

/** accountName は "accounts/123..." をそのまま渡す */
export async function listLocations(accountName: string): Promise<GbpLocation[]> {
  const fields = "name,title,storeCode,storefrontAddress,phoneNumbers,metadata";
  const out: GbpLocation[] = [];
  let pageToken: string | undefined;
  do {
    const q = new URLSearchParams({
      readMask: fields,
      pageSize: "100",
      ...(pageToken ? { pageToken } : {}),
    });
    const json = await gbpFetch<{ locations?: RawLocation[]; nextPageToken?: string }>(
      `${INFO_HOST}/${accountName}/locations?${q}`,
    );
    for (const l of json.locations ?? []) {
      out.push({
        name: l.name,
        title: l.title ?? "",
        storeCode: l.storeCode,
        address: formatAddress(l.storefrontAddress),
        phone: l.phoneNumbers?.primaryPhone,
        mapsUri: l.metadata?.mapsUri,
      });
    }
    pageToken = json.nextPageToken;
  } while (pageToken);
  return out;
}

/** 接続確認の1回分。失敗しても投げずに理由を返す（画面に出すため） */
export async function checkGbpConnection(): Promise<
  | { ok: true; accounts: { account: GbpAccount; locations: GbpLocation[] }[] }
  | { ok: false; kind: GbpErrorKind; message: string }
> {
  try {
    const accounts = await listAccounts();
    const result: { account: GbpAccount; locations: GbpLocation[] }[] = [];
    for (const a of accounts) {
      result.push({ account: a, locations: await listLocations(a.name) });
    }
    return { ok: true, accounts: result };
  } catch (e) {
    if (e instanceof GbpError) return { ok: false, kind: e.kind, message: e.message };
    return { ok: false, kind: "http", message: redact(String(e)) };
  }
}
