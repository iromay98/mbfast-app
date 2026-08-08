// WordPress REST API クライアント（mbPIT自動公開用）。
// 認証: Application Password（Basic）。WP_USER / WP_APP_PASSWORD は .env のみ（コミット禁止）。

const BASE = process.env.WP_BASE_URL ?? "https://mbfasttuning.com";
const API = `${BASE}/wp-json/wp/v2`;

// mbPIT 親カテゴリ（確定ID）
export const MBPIT_PARENT_CATEGORY_ID = 545;

/*
 * 施工区分 → WPタグ（term ID）。ポータル側でジャンル絞り込みに使う。
 *
 * 事前にWP側で作成済みの固定IDを持つ方式にしている。投稿のたびに /wp/v2/tags を
 * 引いて無ければ作る方式は、同時投稿で**同名タグが重複作成**される事故があるため採らない。
 *
 * ecu だけ表示名が「ECUチューニング（施工記録）」なのは、mbFAST本体のブログが使っている
 * 既存タグ「ECUチューニング」(ID 365) と**意図的に分けている**ため。共用すると
 * mbPITの施工記録とmbFAST本体の記事が同じタグアーカイブに混ざり、ブランド分離が崩れる。
 * **365 をここに書かないこと。**
 */
export const PIT_CATEGORY_TAG_IDS: Record<string, number> = {
  ecu: 671, // ECUチューニング（施工記録） slug=ecu
  coating: 663, // コーティング
  polish: 665, // 磨き
  maintenance: 667, // メンテナンス
  other: 669, // その他
};

/** 施工区分に対応するWPタグID（未知の区分は付けない＝勝手に other にしない） */
export function tagIdsForCategory(category: string): number[] {
  const id = PIT_CATEGORY_TAG_IDS[category];
  return id ? [id] : [];
}

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

// STEALTH_MODE: mbPITセクションをURL限定公開にしたい間だけ記事に noindex を付ける。
// 2026-08 に検索へ載せる方針に切り替えたため**既定はOFF**（明示的に "true" のときだけ noindex）。
// 過去のnoindex記事の後追い解除は scripts/pit-clear-noindex.mts（workflow job=noindex）。
function stealthMode(): boolean {
  return process.env.STEALTH_MODE === "true";
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

// 公開済み記事の本文・タイトルを取得（公開後の編集で、画像ブロック等を壊さずに差し替えるため）
export async function fetchPostContent(
  postId: number,
): Promise<{ title: string; contentRaw: string }> {
  const res = await wpFetch(`/posts/${postId}?context=edit&_fields=title,content`, { method: "GET" });
  const p = (await res.json()) as {
    title?: { raw?: string; rendered?: string };
    content?: { raw?: string };
  };
  return { title: p.title?.raw ?? p.title?.rendered ?? "", contentRaw: p.content?.raw ?? "" };
}

/*
 * 既存記事の noindex を外す（STEALTH_MODE 時代に投稿された記事の後追い解除用）。
 * 投稿時に設定していた2箇所（RESTの aioseo_meta_data と AIOSEO専用エンドポイント）を
 * 両方とも「サイト既定に従う＝index可」へ戻す。noindex 以外のAIOSEO設定には触れない。
 * 下書き（公開前確認中）に対しても status を変えずに安全に呼べる。
 */
export async function clearPostNoindex(postId: number): Promise<void> {
  await wpFetch(`/posts/${postId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ aioseo_meta_data: { robots_default: true, robots_noindex: false } }),
  });
  const res = await fetch(`${BASE}/wp-json/aioseo/v1/post`, {
    method: "POST",
    headers: { Authorization: authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ id: postId, default: true, noindex: false }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`AIOSEO noindex解除に失敗 (post=${postId}) ${res.status}: ${body.slice(0, 200)}`);
  }
}

/*
 * 記事の日付（サイトローカル時刻）を取得。
 * 公開前確認の下書きを publish に切り替えるとき、WPが日付を「公開時刻」で
 * 引き直すことがあるため、切替前に読んで status と一緒に再送して施工日を守る。
 */
export async function fetchPostDate(postId: number): Promise<string | null> {
  const res = await wpFetch(`/posts/${postId}?context=edit&_fields=date`, { method: "GET" });
  const p = (await res.json()) as { date?: string };
  return p.date ?? null;
}

// 公開済み記事の更新（タイトル・本文の部分更新）
export async function updatePost(
  postId: number,
  // status: 公開前確認（review）を通した記事を draft → publish に切り替えるのに使う
  fields: { title?: string; content?: string; status?: "publish" | "draft"; date?: string },
): Promise<void> {
  await wpFetch(`/posts/${postId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(fields),
  });
}

/*
 * 既存記事にタグを**足す**（既に付いているタグは消さない）。
 *
 * WPの POST /posts/{id} は tags を渡すと**丸ごと置き換える**ので、
 * 必ず現在値を読んでから和集合を書く。既に全部付いていれば書き込まない。
 * 戻り値: 実際に書き込んだら true、変更不要なら false。
 */
export async function addPostTags(postId: number, tagIds: number[]): Promise<boolean> {
  if (!tagIds.length) return false;
  const res = await wpFetch(`/posts/${postId}?context=edit&_fields=id,tags`, { method: "GET" });
  const cur = (await res.json()) as { tags?: number[] };
  const before = cur.tags ?? [];
  const merged = [...new Set([...before, ...tagIds])];
  if (merged.length === before.length) return false;
  await wpFetch(`/posts/${postId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tags: merged }),
  });
  return true;
}

/** 記事に現在付いているタグID（遡及付与の事前確認用） */
export async function fetchPostTags(postId: number): Promise<number[]> {
  const res = await wpFetch(`/posts/${postId}?context=edit&_fields=id,tags`, { method: "GET" });
  const p = (await res.json()) as { tags?: number[] };
  return p.tags ?? [];
}

// 記事をゴミ箱へ（完全削除しない＝誤操作から復元できるようにする）
export async function trashPost(postId: number): Promise<void> {
  await wpFetch(`/posts/${postId}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ status: "trash" }),
  });
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
  /** 施工区分のWPタグ（tagIdsForCategory で引く）。空なら tags を送らない */
  tagIds?: number[];
  featuredMediaId?: number;
  metaDescription?: string;
  focusKeyword?: string;
  /**
   * 公開前確認（店舗設定 postReviewRequired）のとき true。
   * AUTO_PUBLISH に関係なく WordPress へ下書きで作る（店舗が読んでから公開する）。
   */
  forceDraft?: boolean;
  /**
   * 記事の公開日時（WPサイトのローカル時刻 "YYYY-MM-DDTHH:MM:SS"）。
   * 施工日をまとめて後日投稿したとき、WP上の記事日付を実際の作業日にするために使う。
   * 未指定なら投稿時刻（WP既定）。
   */
  date?: string;
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
    status: input.forceDraft || !autoPublish() ? "draft" : "publish",
    categories: input.categoryIds,
  };
  // 空配列を送るとWP側は「タグ全消し」と解釈する。付けるものが無いならキー自体を出さない
  if (input.tagIds?.length) body.tags = input.tagIds;
  if (input.date) body.date = input.date;
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
