// WordPress REST API クライアント（mbPIT自動公開用）。
// 認証: Application Password（Basic）。WP_USER / WP_APP_PASSWORD は .env のみ（コミット禁止）。

const BASE = process.env.WP_BASE_URL ?? "https://mbfasttuning.com";
const API = `${BASE}/wp-json/wp/v2`;

// mbPIT 親カテゴリ（確定ID）
export const MBPIT_PARENT_CATEGORY_ID = 545;

// AUTO_PUBLISH=false で下書き投稿（既定は即公開）
function autoPublish(): boolean {
  return process.env.AUTO_PUBLISH !== "false";
}

// STEALTH_MODE: mbPITセクションがURL限定公開の間は記事に noindex を付ける。
// 未設定なら true（誤ってインデックスさせない安全側）。公開解禁時に .env で false にする。
function stealthMode(): boolean {
  return process.env.STEALTH_MODE !== "false";
}

export function wpConfigured(): boolean {
  return !!process.env.WP_USER && !!process.env.WP_APP_PASSWORD;
}

function authHeader(): string {
  const user = process.env.WP_USER;
  const pass = process.env.WP_APP_PASSWORD;
  if (!user || !pass) throw new Error("WP_USER / WP_APP_PASSWORD が未設定です");
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

async function wpFetch(path: string, init: RequestInit): Promise<Response> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: { Authorization: authHeader(), ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`WordPress API ${path} ${res.status}: ${body.slice(0, 300)}`);
  }
  return res;
}

export type WpMedia = { id: number; sourceUrl: string };

// 画像アップロード（Content-Disposition 必須）→ alt を PATCH で設定
export async function uploadMedia(
  buffer: Buffer,
  filename: string,
  alt: string,
  contentType = "image/webp",
): Promise<WpMedia> {
  const res = await wpFetch(`/media`, {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${filename.replace(/[^\w.\-]/g, "_")}"`,
    },
    body: new Uint8Array(buffer),
  });
  const media = (await res.json()) as { id: number; source_url: string };

  if (alt) {
    await wpFetch(`/media/${media.id}`, {
      method: "POST", // WPは POST でも PATCH 相当の部分更新
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ alt_text: alt }),
    }).catch(() => {}); // altは失敗しても公開は続行
  }
  return { id: media.id, sourceUrl: media.source_url };
}

export type WpPostInput = {
  title: string;
  slug: string;
  contentHtml: string;
  categoryIds: number[];
  featuredMediaId?: number;
  metaDescription?: string;
  focusKeyword?: string;
};

export type WpPost = { id: number; link: string };

// 記事公開（AUTO_PUBLISH=falseならdraft）＋ AIOSEO メタ同時設定＋ STEALTH_MODE時はnoindex
export async function publishPost(input: WpPostInput): Promise<WpPost> {
  const stealth = stealthMode();
  const body: Record<string, unknown> = {
    title: input.title,
    slug: input.slug,
    content: input.contentHtml,
    status: autoPublish() ? "publish" : "draft",
    categories: input.categoryIds,
  };
  if (input.featuredMediaId) body.featured_media = input.featuredMediaId;
  body.aioseo_meta_data = {
    ...(input.metaDescription ? { description: input.metaDescription } : {}),
    ...(input.focusKeyword ? { focus_keyphrase: input.focusKeyword } : {}),
    // noindex（robotsのデフォルト設定を外して個別指定）
    ...(stealth ? { robots_default: false, robots_noindex: true } : {}),
  };
  const res = await wpFetch(`/posts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const post = (await res.json()) as { id: number; link: string };

  // AIOSEOのバージョンによって aioseo_meta_data が無視されることがあるため、
  // ステルス運用中は専用エンドポイントでも noindex を適用（失敗しても公開は続行し、ログのみ）
  if (stealth) {
    try {
      await fetch(`${BASE}/wp-json/aioseo/v1/post`, {
        method: "POST",
        headers: { Authorization: authHeader(), "Content-Type": "application/json" },
        body: JSON.stringify({ id: post.id, default: false, noindex: true }),
      });
    } catch (e) {
      console.error(`mbPIT: noindex適用に失敗 (post=${post.id})`, e);
    }
  }
  return { id: post.id, link: post.link };
}
