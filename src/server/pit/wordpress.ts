// WordPress REST API クライアント（mbPIT自動公開用）。
// 認証: Application Password（Basic）。WP_USER / WP_APP_PASSWORD は .env のみ（コミット禁止）。

const BASE = process.env.WP_BASE_URL ?? "https://mbfasttuning.com";
const API = `${BASE}/wp-json/wp/v2`;

// mbPIT 親カテゴリ（確定ID）
export const MBPIT_PARENT_CATEGORY_ID = 545;

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
): Promise<WpMedia> {
  const res = await wpFetch(`/media`, {
    method: "POST",
    headers: {
      "Content-Type": "image/jpeg",
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

// 記事公開（status=publish）＋ AIOSEO メタ同時設定
export async function publishPost(input: WpPostInput): Promise<WpPost> {
  const body: Record<string, unknown> = {
    title: input.title,
    slug: input.slug,
    content: input.contentHtml,
    status: "publish",
    categories: input.categoryIds,
  };
  if (input.featuredMediaId) body.featured_media = input.featuredMediaId;
  if (input.metaDescription || input.focusKeyword) {
    body.aioseo_meta_data = {
      ...(input.metaDescription ? { description: input.metaDescription } : {}),
      ...(input.focusKeyword ? { focus_keyphrase: input.focusKeyword } : {}),
    };
  }
  const res = await wpFetch(`/posts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const post = (await res.json()) as { id: number; link: string };
  return { id: post.id, link: post.link };
}
