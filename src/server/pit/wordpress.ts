// WordPress REST API クライアント（mbPIT自動公開用）。
// 認証: Application Password（Basic）。WP_USER / WP_APP_PASSWORD は .env のみ（コミット禁止）。

const BASE = process.env.WP_BASE_URL ?? "https://mbfasttuning.com";
const API = `${BASE}/wp-json/wp/v2`;

// mbPIT 親カテゴリ（確定ID）
export const MBPIT_PARENT_CATEGORY_ID = 545;

// mbPIT OGP画像（本部指定・全記事共通）
const MBPIT_OGP_URL = "https://mbfasttuning.com/wp-content/uploads/2026/07/mbpit-ogp.jpg";

// mbPITブランドブロック: mbPITはmbFASTと別ブランドとして運用するため、
// 記事表示時にサイトのヘッダー/フッター/mbFAST要素を隠し、mbPIT独自トップバーを出す。
// mbpit.comへの移行後は不要になるので、この定数だけ消せば全記事分の挿入が止まる。
const BRAND_BLOCK = `<!-- wp:html -->
<style>
.siteHeader,.siteFooter,.vk-mobile-nav-menu-outer,.vk-mobile-nav,.mobile-fix-nav,.vk-menu-acc-btn,
.breadcrumb,.veu-breadcrumb,#breadcrumb,.veu_socialSet,.veu_pageTop,.page_top_btn,
.sideSection,aside.sideSection,.copySection,.mbsel-row,.mbsel-panel,#mbsel-panel,.lang-switcher,.veu_sns,.snsBtns{display:none!important}
.mainSection{width:100%!important;max-width:100%!important}
body{padding-top:0!important}
.mbpit-topbar{background:#0d0d0d;padding:14px 20px;display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #c9a227;border-radius:0 0 10px 10px;margin-bottom:10px}
.mbpit-topbar a.mbpit-logo{display:flex;align-items:center}
.mbpit-topbar .mbpit-tagline{color:#aaa;font-size:.75em}
</style>
<div class="mbpit-topbar"><a class="mbpit-logo" href="https://mbfasttuning.com/mbpit/"><img src="https://mbfasttuning.com/wp-content/uploads/2026/07/mbpit-logo-gold.webp" alt="mbPIT" style="height:34px;width:auto"></a><span class="mbpit-tagline">加盟店の施工記録ポータル</span></div>
<!-- /wp:html -->`;

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

export type WpCategory = {
  id: number;
  name: string;
  slug: string;
  count: number;
  parent: number;
  meta: Record<string, unknown>;
};

// mbPIT親カテゴリ(545)直下の店舗カテゴリ一覧（term meta 付き）。
// parent=545 で問い合わせるため、返るtermは構造上すべて545配下（誤書き込み防止の第一の壁）。
export async function fetchMbpitCategories(): Promise<WpCategory[]> {
  const res = await wpFetch(
    `/categories?parent=${MBPIT_PARENT_CATEGORY_ID}&per_page=100&_fields=id,name,slug,count,parent,meta`,
    { method: "GET" },
  );
  return (await res.json()) as WpCategory[];
}

// 店舗term metaの書き込み前に必ず呼ぶ安全弁: 対象termが545直下であることをWP側に確認する。
// （店舗マスター同期は既存の代理店カテゴリツリーに絶対に触れない）
export async function assertTermUnderMbpit(termId: number): Promise<WpCategory> {
  const res = await wpFetch(`/categories/${termId}?_fields=id,name,slug,count,parent,meta`, { method: "GET" });
  const term = (await res.json()) as WpCategory;
  if (term.parent !== MBPIT_PARENT_CATEGORY_ID) {
    throw new Error(`term ${termId} は mbPIT親カテゴリ(545)配下ではありません（parent=${term.parent}）。書き込みを中止しました`);
  }
  return term;
}

// 新規加盟店の店舗カテゴリを mbPIT親カテゴリ(545)配下に作成してIDを返す。
// 同名/同slugのカテゴリが既にある場合（term_exists）は既存IDを再利用する。
// 既存の代理店カテゴリツリーには一切触れない（新規作成のみ・親は必ず545）。
export async function createStoreCategory(name: string, slug: string): Promise<number> {
  const res = await fetch(`${API}/categories`, {
    method: "POST",
    headers: { Authorization: authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ name, slug, parent: MBPIT_PARENT_CATEGORY_ID }),
  });
  const data = (await res.json().catch(() => null)) as
    | { id?: number; code?: string; message?: string; data?: { term_id?: number } }
    | null;
  if (res.ok && typeof data?.id === "number") return data.id;
  if (data?.code === "term_exists" && typeof data.data?.term_id === "number") {
    // 既存カテゴリが545配下なら再利用。別ツリー（既存の代理店カテゴリ等）なら誤流用しない
    const existing = await wpFetch(`/categories/${data.data.term_id}`, { method: "GET" })
      .then((r) => r.json() as Promise<{ id: number; parent: number }>)
      .catch(() => null);
    if (existing?.parent === MBPIT_PARENT_CATEGORY_ID) return existing.id;
    throw new Error(
      `同名/同slugのカテゴリがmbPIT外に既に存在します（ID:${data.data.term_id}）。slugを変えるかカテゴリIDを手入力してください`,
    );
  }
  throw new Error(
    `WordPressカテゴリ作成に失敗 (${res.status}): ${data?.message ?? JSON.stringify(data)?.slice(0, 200) ?? ""}`,
  );
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

// 記事公開（AUTO_PUBLISH=falseならdraft）
// - 本文冒頭にブランドブロックを必ず挿入（mbPIT独立ブランド表示）
// - AIOSEO: タイトル上書き（「– mbFAST Tuning」サフィックス除去）・OGP画像は常時適用、
//   noindex は STEALTH_MODE 時のみ（キー名は本部側で実機検証済み）
export async function publishPost(input: WpPostInput): Promise<WpPost> {
  const stealth = stealthMode();
  const body: Record<string, unknown> = {
    title: input.title,
    slug: input.slug,
    content: `${BRAND_BLOCK}\n${input.contentHtml}`,
    status: autoPublish() ? "publish" : "draft",
    categories: input.categoryIds,
  };
  if (input.featuredMediaId) body.featured_media = input.featuredMediaId;
  body.aioseo_meta_data = {
    ...(input.metaDescription ? { description: input.metaDescription } : {}),
    ...(input.focusKeyword ? { focus_keyphrase: input.focusKeyword } : {}),
    ...(stealth ? { robots_default: false, robots_noindex: true } : {}),
  };
  const res = await wpFetch(`/posts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const post = (await res.json()) as { id: number; link: string };

  // AIOSEO専用エンドポイントで タイトル/OGP（常時）＋ noindex（ステルス時）をまとめて適用。
  // 失敗しても公開は続行（ログのみ）。
  try {
    await fetch(`${BASE}/wp-json/aioseo/v1/post`, {
      method: "POST",
      headers: { Authorization: authHeader(), "Content-Type": "application/json" },
      body: JSON.stringify({
        id: post.id,
        title: input.title, // サイト名サフィックス（– mbFAST Tuning）を消す
        og_title: input.title,
        og_image_type: "custom_image",
        og_image_custom_url: MBPIT_OGP_URL,
        twitter_use_og: false,
        twitter_image_type: "custom_image",
        twitter_image_custom_url: MBPIT_OGP_URL,
        ...(stealth ? { default: false, noindex: true } : {}),
      }),
    });
  } catch (e) {
    console.error(`mbPIT: AIOSEOメタ適用に失敗 (post=${post.id})`, e);
  }
  return { id: post.id, link: post.link };
}
