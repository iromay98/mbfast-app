/*
 * GA4 Data API（サービスアカウント認証）。
 *
 * 目的: 加盟店ホームに「自店のmbPIT記事がどれだけ読まれたか」を出す。
 * GBPの表示実績（マップで見られた数）と並べて、掲載効果の全体像を見せる。
 *
 * 認証はサービスアカウントのJWT（RS256）を自前で署名してアクセストークンに
 * 交換する。googleapis等の重い依存を足さないための選択。
 *
 * 必要なenv（未設定なら機能ごと無効＝ホームには何も出ない）:
 *   GA4_PROPERTY_ID … GA4のプロパティID（数字）
 *   GA4_SA_EMAIL    … サービスアカウントのメール
 *   GA4_SA_KEY      … サービスアカウント秘密鍵PEMのbase64 1行
 *                      （改行がenvで崩れるのを避ける。VPS_SSH_KEYと同じ運用）
 * セットアップ: Cloud Consoleでサービスアカウント作成→鍵(JSON)発行→
 *   private_key をbase64化してenvへ→GA4のプロパティ「アクセス管理」に
 *   サービスアカウントのメールを「閲覧者」で追加。
 */
import { createSign } from "node:crypto";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/analytics.readonly";

export function ga4Configured(): boolean {
  return !!(process.env.GA4_PROPERTY_ID && process.env.GA4_SA_EMAIL && process.env.GA4_SA_KEY);
}

function privateKeyPem(): string {
  const raw = process.env.GA4_SA_KEY ?? "";
  if (raw.includes("BEGIN")) return raw.replace(/\\n/g, "\n");
  return Buffer.from(raw.replace(/\s/g, ""), "base64").toString("utf8");
}

const b64u = (v: Buffer | string) =>
  Buffer.from(v).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

let cachedToken: { token: string; exp: number } | null = null;

async function accessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.exp - 60_000) return cachedToken.token;
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64u(
    JSON.stringify({
      iss: process.env.GA4_SA_EMAIL,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claim}`);
  const sig = b64u(signer.sign(privateKeyPem()));
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claim}.${sig}`,
    }),
  });
  if (!res.ok) throw new Error(`GA4トークン取得失敗: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as { access_token: string; expires_in: number };
  cachedToken = { token: j.access_token, exp: Date.now() + j.expires_in * 1000 };
  return j.access_token;
}

export type StoreArticleStats = {
  views: number;
  users: number;
  top: { title: string; views: number }[];
};

/** 店slug配下（/mbpit/{slug}/…）の直近30日の閲覧実績 */
export async function fetchStoreArticleStats(storeSlug: string): Promise<StoreArticleStats> {
  const token = await accessToken();
  const body = {
    dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
    dimensions: [{ name: "pagePath" }, { name: "pageTitle" }],
    metrics: [{ name: "screenPageViews" }, { name: "activeUsers" }],
    dimensionFilter: {
      filter: {
        fieldName: "pagePath",
        stringFilter: { matchType: "BEGINS_WITH", value: `/mbpit/${storeSlug}/` },
      },
    },
    orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
    limit: "50",
  };
  const res = await fetch(
    `https://analyticsdata.googleapis.com/v1beta/properties/${process.env.GA4_PROPERTY_ID}:runReport`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) throw new Error(`GA4集計失敗: ${res.status} ${await res.text()}`);
  const j = (await res.json()) as {
    rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[];
  };
  let views = 0;
  let users = 0;
  const top: { title: string; views: number }[] = [];
  for (const r of j.rows ?? []) {
    const path = r.dimensionValues[0]?.value ?? "";
    const v = Number(r.metricValues[0]?.value ?? 0);
    const u = Number(r.metricValues[1]?.value ?? 0);
    views += v;
    users += u;
    // 店トップページ自体は「人気記事」には数えない
    if (top.length < 3 && path !== `/mbpit/${storeSlug}/`) {
      const title = (r.dimensionValues[1]?.value ?? "")
        .replace(/｜mbFAST Tuning.*$/, "")
        .replace(/\s*[|｜-]\s*mbPIT.*$/, "")
        .replace(/^【施工記録】/, "")
        .trim();
      if (title) top.push({ title: title.slice(0, 40), views: v });
    }
  }
  return { views, users, top };
}
