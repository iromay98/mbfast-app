/*
 * mbfasttuning.com WordPress REST API クライアント（mbPIT 自動公開用）。
 * 認証は Application Password の Basic 認証。資格情報は環境変数のみ（コミット禁止）:
 *   WP_BASE_URL      既定 https://mbfasttuning.com
 *   WP_USER          Application Password のユーザー名
 *   WP_APP_PASSWORD  Application Password
 *
 * 重要: 既存の「代理店」カテゴリツリー（本部管理の mbFAST 施工ブログ）には一切触れない。
 * このモジュールが付与するカテゴリは mbPIT 親カテゴリ(545)＋店舗カテゴリ＋（任意の）ジャンル。
 */

// mbPIT 親カテゴリ（作成済み・ID確定, slug: mbpit）
export const PIT_PARENT_CATEGORY_ID = 545;

export type WpMedia = { id: number; sourceUrl: string };
export type WpPost = { id: number; url: string };

function baseUrl(): string {
  return (process.env.WP_BASE_URL ?? "https://mbfasttuning.com").replace(/\/+$/, "");
}

export function wpConfigured(): boolean {
  return !!process.env.WP_USER && !!process.env.WP_APP_PASSWORD;
}

function authHeader(): string {
  const user = process.env.WP_USER;
  const pass = process.env.WP_APP_PASSWORD;
  if (!user || !pass) {
    throw new Error("WordPress 認証情報 (WP_USER / WP_APP_PASSWORD) が未設定です");
  }
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

async function wpFetch(path: string, init: RequestInit): Promise<Response> {
  const res = await fetch(`${baseUrl()}/wp-json/wp/v2${path}`, {
    ...init,
    headers: { Authorization: authHeader(), ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`WordPress API エラー ${res.status} (${path}): ${body.slice(0, 300)}`);
  }
  return res;
}

/** 画像を /media にアップロードし、alt テキストを設定する。 */
export async function uploadMedia(
  buffer: Buffer,
  filename: string,
  altText: string,
): Promise<WpMedia> {
  const res = await wpFetch("/media", {
    method: "POST",
    headers: {
      // Content-Disposition 必須（これが無いと WP がファイル名を解決できない）
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": "image/jpeg",
    },
    body: new Uint8Array(buffer),
  });
  const media = (await res.json()) as { id: number; source_url: string };

  // alt テキストは作成後に更新（作成リクエストはバイナリボディのため同時指定できない）
  await wpFetch(`/media/${media.id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ alt_text: altText }),
  }).catch((e) => {
    // alt 設定失敗は公開を止めない（ログのみ）
    console.error(`mbPIT: media#${media.id} の alt 設定に失敗`, e);
  });

  return { id: media.id, sourceUrl: media.source_url };
}

/** 記事を status=publish で作成し、AIOSEO メタも同時設定する。 */
export async function publishPost(opts: {
  title: string;
  slug: string;
  contentHtml: string;
  categoryIds: number[];
  featuredMediaId?: number;
  metaDescription: string;
  focusKeyword: string;
}): Promise<WpPost> {
  const res = await wpFetch("/posts", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      status: "publish",
      title: opts.title,
      slug: opts.slug,
      content: opts.contentHtml,
      categories: opts.categoryIds,
      ...(opts.featuredMediaId ? { featured_media: opts.featuredMediaId } : {}),
      // AIOSEO（All in One SEO）の REST フィールド
      aioseo_meta_data: {
        description: opts.metaDescription,
        keyphrases: { focus: { keyphrase: opts.focusKeyword } },
      },
    }),
  });
  const post = (await res.json()) as { id: number; link: string };
  return { id: post.id, url: post.link };
}

/** 施工ジャンルカテゴリID（任意）。環境変数 PIT_GENRE_CATEGORY_IDS に JSON で設定:
 *  例 {"ECU":557,"COATING":559,"POLISH":561,"MAINTENANCE":563,"OTHER":565}
 *  未設定/未定義ジャンルはカテゴリ付与をスキップする。 */
export function genreCategoryId(category: string): number | null {
  const raw = process.env.PIT_GENRE_CATEGORY_IDS;
  if (!raw) return null;
  try {
    const map = JSON.parse(raw) as Record<string, number>;
    const id = map[category];
    return typeof id === "number" && Number.isFinite(id) ? id : null;
  } catch {
    console.error("mbPIT: PIT_GENRE_CATEGORY_IDS の JSON が不正です");
    return null;
  }
}
