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

/*
 * アカウントIDを環境変数で固定できるようにする。
 *
 * accounts.list は Account Management API を叩く＝この割り当てが0だと何も始まらない。
 * だがアカウントIDは一度分かれば変わらないので、控えておけば通常運用では
 * accounts.list を呼ばずに済む（ロケーション取得・投稿は別APIで、割り当ても別枠）。
 * 形式は "accounts/123..." でも数字だけでも受ける。
 */
export function configuredAccountId(): string | null {
  const raw = (process.env.GBP_ACCOUNT_ID ?? "").trim();
  if (!raw) return null;
  const digits = raw.replace(/^accounts\//, "");
  return /^[0-9]+$/.test(digits) ? `accounts/${digits}` : null;
}

/*
 * ロケーションIDの手動指定。
 *
 * Account Management / Business Information の割り当てが0（アクセス未承認）でも、
 * v4(mybusiness.googleapis.com) の割り当てが生きていれば投稿はできる。
 * その間は一覧APIを一切呼ばず、店舗→ロケーションの対応を環境変数で与える。
 *
 *   GBP_LOCATION_MAP="pleasure:18204209748554497603,kisarazu:1600847083813484494"
 *
 * キーは店舗の slug（推奨）か PitStore.id。値は "locations/123..." でも数字だけでも可。
 * 割り当てが下りたら一覧＋画面での紐付け（DB側）に移行でき、この指定は消せる。
 */
export function configuredLocationMap(): Map<string, string> {
  const out = new Map<string, string>();
  const raw = (process.env.GBP_LOCATION_MAP ?? "").trim();
  if (!raw) return out;
  for (const part of raw.split(",")) {
    const [keyRaw, valRaw] = part.split(":");
    const key = (keyRaw ?? "").trim();
    const digits = (valRaw ?? "").trim().replace(/^locations\//, "");
    if (!key || !/^[0-9]+$/.test(digits)) continue;
    out.set(key, `locations/${digits}`);
  }
  return out;
}

/*
 * mbFASTを管理者に招待するためのGoogleアカウント（メールアドレス）。
 *
 * これは秘密情報ではない（加盟店が自店のGoogleビジネスプロフィールに管理者として
 * 招待する宛先＝相手に伝えることが目的）。認証情報（CLIENT_SECRET等）とは別物。
 * 未設定なら null を返し、画面は「本部にお問い合わせください」を出す。
 */
export function gbpManagerEmail(): string | null {
  const raw = (process.env.GBP_MANAGER_EMAIL ?? "").trim();
  // ざっくりメール形式のときだけ返す（typoで変な文字列を画面に出さない）
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(raw) ? raw : null;
}

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
  | "invalid" // 送信前の自前検証で弾いた（Googleには投げていない）
  | "http"
  | "network";

export class GbpError extends Error {
  kind: GbpErrorKind;
  /** HTTPステータス */
  status?: number;
  /** Googleの error.status（PERMISSION_DENIED / RESOURCE_EXHAUSTED 等） */
  apiStatus?: string;
  /** Googleの error.message（そのまま） */
  apiMessage?: string;
  /** 呼び出したURL（クエリを含む。秘密は含まない） */
  url?: string;
  /** レスポンス本文（redact 済み） */
  body?: string;
  /** error.details から拾った要点（割り当て超過ならメトリック名と上限） */
  details?: string[];
  constructor(
    message: string,
    kind: GbpErrorKind,
    extra?: {
      status?: number;
      apiStatus?: string;
      apiMessage?: string;
      url?: string;
      body?: string;
      details?: string[];
    },
  ) {
    super(message);
    this.name = "GbpError";
    this.kind = kind;
    Object.assign(this, extra ?? {});
  }
}

type GoogleErrorBody = {
  error?: {
    code?: number;
    message?: string;
    status?: string;
    details?: {
      "@type"?: string;
      reason?: string;
      domain?: string;
      metadata?: Record<string, string>;
      violations?: { subject?: string; description?: string; quotaMetric?: string; quotaId?: string; quotaValue?: string }[];
      links?: { description?: string; url?: string }[];
    }[];
  };
};

/*
 * Googleのエラー本文を「そのまま読める形」に開く。
 * 種別の推測だけで済ませると（例: 403を全部「権限」と言う）原因を取り違えるため、
 * error.status / error.message / details を必ず持ち回る。
 */
export function parseGoogleError(bodyText: string): {
  apiStatus?: string;
  apiMessage?: string;
  details: string[];
} {
  let json: GoogleErrorBody | null = null;
  try {
    json = JSON.parse(bodyText) as GoogleErrorBody;
  } catch {
    return { details: [] };
  }
  const e = json?.error;
  const details: string[] = [];
  for (const d of e?.details ?? []) {
    const t = (d["@type"] ?? "").split("/").pop();
    if (d.reason) details.push(`reason: ${d.reason}${d.domain ? ` (${d.domain})` : ""}`);
    for (const [k, v] of Object.entries(d.metadata ?? {})) details.push(`${k}: ${v}`);
    for (const v of d.violations ?? []) {
      const parts = [
        v.quotaMetric ? `metric=${v.quotaMetric}` : "",
        v.quotaId ? `id=${v.quotaId}` : "",
        v.quotaValue ? `limit=${v.quotaValue}` : "",
        v.subject ? `subject=${v.subject}` : "",
        v.description ?? "",
      ].filter(Boolean);
      if (parts.length) details.push(parts.join(" / "));
    }
    for (const l of d.links ?? []) if (l.url) details.push(`${l.description ?? "link"}: ${l.url}`);
    if (!d.reason && !d.metadata && !d.violations && !d.links && t) details.push(t);
  }
  return { apiStatus: e?.status, apiMessage: e?.message, details };
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
    throw new GbpError(`アクセストークンを取得できませんでした: ${redact(text)}`, kind, {
      status: res.status,
      url: TOKEN_URL,
      body: redact(text),
    });
  }
  const json = JSON.parse(text) as { access_token?: string; expires_in?: number };
  if (!json.access_token) throw new GbpError("アクセストークンが空でした", "auth", { status: res.status });
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
  if (!res.ok) {
    const parsed = parseGoogleError(text);
    throw new GbpError(
      redact(parsed.apiMessage ?? text) || `HTTP ${res.status}`,
      kindOf(res.status, parsed.apiStatus ?? "", text),
      {
        status: res.status,
        apiStatus: parsed.apiStatus,
        apiMessage: parsed.apiMessage ? redact(parsed.apiMessage) : undefined,
        url,
        body: redact(text),
        details: parsed.details.map(redact),
      },
    );
  }
  return (text ? JSON.parse(text) : {}) as T;
}

/*
 * 種別の判定は error.status を優先する（HTTPステータスだけでは 403 の意味が割れる:
 * API未有効化・スコープ不足・割り当て0 がどれも 403 で来る）。
 */
function kindOf(httpStatus: number, apiStatus: string, body: string): GbpErrorKind {
  if (apiStatus === "RESOURCE_EXHAUSTED") return "quota";
  if (apiStatus === "PERMISSION_DENIED") return "permission";
  if (apiStatus === "UNAUTHENTICATED") return "auth";
  if (apiStatus === "NOT_FOUND") return "notfound";
  if (httpStatus === 401) return "auth";
  if (httpStatus === 403) return /RESOURCE_EXHAUSTED|quota/i.test(body) ? "quota" : "permission";
  if (httpStatus === 404) return "notfound";
  if (httpStatus === 429) return "quota";
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

// ── v4 (投稿) ────────────────────────────────────────────

export type LocalPost = {
  /** "accounts/{a}/locations/{l}/localPosts/{p}" */
  name: string;
  state?: string;
  topicType?: string;
  summary?: string;
  createTime?: string;
  searchUrl?: string;
};

/*
 * localPosts の一覧（GET）。**投稿は作らない**。
 * v4 の割り当てが生きているかを確かめる最小のリクエストとして使う。
 * accountId/locationId は "accounts/123" / "locations/456" 形式で受ける。
 */
export async function listLocalPosts(
  accountId: string,
  locationId: string,
  pageSize = 1,
): Promise<{ posts: LocalPost[]; nextPageToken?: string }> {
  const acc = accountId.startsWith("accounts/") ? accountId : `accounts/${accountId}`;
  const loc = locationId.startsWith("locations/") ? locationId : `locations/${locationId}`;
  const q = new URLSearchParams({ pageSize: String(pageSize) });
  const json = await gbpFetch<{ localPosts?: LocalPost[]; nextPageToken?: string }>(
    `${V4_HOST}/${acc}/${loc}/localPosts?${q}`,
  );
  return { posts: json.localPosts ?? [], nextPageToken: json.nextPageToken };
}

/*
 * 投稿の下書きデータ。
 *
 * GBPの投稿は**作成後に編集できない**（消して作り直すしかない）ため、
 * 送る前に画面で確認できるよう、組み立てと送信を分けている。
 */
export type LocalPostDraft = {
  /** 本文。1,500字まで。ただし一覧では先頭80〜100字ほどしか読まれない */
  summary: string;
  /** 行動を促すボタン。省略時はボタン無し */
  cta?: { type: "LEARN_MORE" | "BOOK" | "CALL"; url?: string };
  /** 写真1枚。公開URLをGoogleが取得する（要 https・リダイレクト不可） */
  photoUrl?: string;
};

export const LOCAL_POST_SUMMARY_MAX = 1500;

/*
 * 投稿の作成（POST）。
 *
 * このプロジェクト(mbfast-tuning)の割り当ては **Create requests per day = 100**
 * （2026-08-13 に Cloud Console の「割り当てと上限」で実測）。
 * 加盟店1店が1日1件投稿する前提なら100店まで足りるが、複数拠点や再投稿を
 * 考えると余裕は大きくない。上限に達すると RESOURCE_EXHAUSTED（kind="quota"）
 * が返る。増枠は Cloud Console から申請できる。
 *
 * topicType は STANDARD 固定。イベント/特典は別フィールドが必須になるため、
 * 施工記録の告知にはこれで足りる。
 */
export async function createLocalPost(
  accountId: string,
  locationId: string,
  draft: LocalPostDraft,
): Promise<LocalPost> {
  const acc = accountId.startsWith("accounts/") ? accountId : `accounts/${accountId}`;
  const loc = locationId.startsWith("locations/") ? locationId : `locations/${locationId}`;
  const summary = draft.summary.trim();
  if (!summary) throw new GbpError("本文が空です", "invalid");
  if (summary.length > LOCAL_POST_SUMMARY_MAX) {
    throw new GbpError(`本文が${LOCAL_POST_SUMMARY_MAX}字を超えています（${summary.length}字）`, "invalid");
  }
  const body: Record<string, unknown> = {
    languageCode: "ja",
    summary,
    topicType: "STANDARD",
  };
  if (draft.cta?.type) {
    body.callToAction = draft.cta.url
      ? { actionType: draft.cta.type, url: draft.cta.url }
      : { actionType: draft.cta.type };
  }
  if (draft.photoUrl) {
    body.media = [{ mediaFormat: "PHOTO", sourceUrl: draft.photoUrl }];
  }
  return gbpFetch<LocalPost>(`${V4_HOST}/${acc}/${loc}/localPosts`, { method: "POST", body });
}

/** 投稿の削除。GBPは編集ができないので、直すときは消して作り直す */
export async function deleteLocalPost(postName: string): Promise<void> {
  await gbpFetch<unknown>(`${V4_HOST}/${postName}`, { method: "DELETE" });
}

/** 接続確認の1回分。失敗しても投げずに理由を返す（画面に出すため） */
export type GbpFailure = {
  ok: false;
  kind: GbpErrorKind;
  message: string;
  /** 生の応答（原因の切り分けに使う。すべて redact 済み） */
  httpStatus?: number;
  apiStatus?: string;
  apiMessage?: string;
  url?: string;
  body?: string;
  details?: string[];
};

export async function checkGbpConnection(): Promise<
  { ok: true; accounts: { account: GbpAccount; locations: GbpLocation[] }[] } | GbpFailure
> {
  try {
    // GBP_ACCOUNT_ID が指定されていれば accounts.list を呼ばない
    // （Account Management API の割り当てを使わずにロケーションを取れる）
    const fixed = configuredAccountId();
    if (fixed) {
      const locations = await listLocations(fixed);
      return {
        ok: true,
        accounts: [
          {
            account: {
              name: fixed,
              accountName: "（GBP_ACCOUNT_ID で指定）",
              type: "-",
              role: "-",
            },
            locations,
          },
        ],
      };
    }
    const accounts = await listAccounts();
    const result: { account: GbpAccount; locations: GbpLocation[] }[] = [];
    for (const a of accounts) {
      result.push({ account: a, locations: await listLocations(a.name) });
    }
    return { ok: true, accounts: result };
  } catch (e) {
    if (e instanceof GbpError) {
      return {
        ok: false,
        kind: e.kind,
        message: e.message,
        httpStatus: e.status,
        apiStatus: e.apiStatus,
        apiMessage: e.apiMessage,
        url: e.url,
        body: e.body,
        details: e.details,
      };
    }
    return { ok: false, kind: "http", message: redact(String(e)) };
  }
}
