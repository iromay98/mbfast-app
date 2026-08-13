/*
 * 車両ページ → WordPress の同期エンジン。
 *
 * 価格表（prices/wp-sync.ts）と同じ原則:
 *   1) 既定は読み取りのみ（diff）。書き込みは明示的に apply したときだけ
 *   2) 更新は**マーカー区間だけを差し替える**（マーカー外は人の追記領域として保護）
 *   3) REST保存で壊れる内容（<script> 内のアンパサンド）を書き込む前に弾く
 *
 * 価格表と違う点: ページを**新規作成**する（wpPageIdJp/En が null の場合）。
 *   - 親階層 /tuning/ → /tuning/{brandSlug}/ は ensureParentPage が slug 照合で用意する
 *   - ENページは Polylang（lang=en + translations で JP と紐付け）
 *   - 新規作成時のWPステータスは VehiclePage.status に従う（draft / publish）。hold は対象外
 */
import { VPAGE_MARK_END, VPAGE_MARK_START } from "./generate-html";

const BASE = process.env.WP_BASE_URL ?? "https://mbfasttuning.com";
const API = `${BASE}/wp-json/wp/v2`;

export function wpConfigured(): boolean {
  return !!process.env.WP_USER && !!process.env.WP_APP_PASSWORD;
}

function authHeader(): string {
  const user = process.env.WP_USER;
  const pass = process.env.WP_APP_PASSWORD;
  if (!user || !pass) throw new Error("WP_USER / WP_APP_PASSWORD が未設定です");
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

async function wpFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: authHeader(),
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  return res;
}

async function readJson<T>(res: Response, label: string): Promise<T> {
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${label}: HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  // AIOSEO Pro がJSONの前にPHP警告を出すことがある（EN系で既知）→ 最初の { / [ まで捨てる
  const text = await res.text();
  const i = Math.min(...[text.indexOf("{"), text.indexOf("[")].filter((n) => n >= 0));
  return JSON.parse(text.slice(i)) as T;
}

/** REST保存で壊れる内容の検査（scriptタグ内のアンパサンド）。価格表と同じ理由 */
export function findUnsafeScriptContent(html: string): string | null {
  const scripts = html.match(/<script\b[^>]*>[\s\S]*?<\/script>/g) ?? [];
  for (const s of scripts) {
    // JSON-LD は \u0026 エスケープ済みのはず。生の & が残っていたら弾く
    const body = s.replace(/^<script\b[^>]*>/, "").replace(/<\/script>$/, "");
    if (body.includes("&")) return s.slice(0, 120);
    if (body.includes(String.fromCharCode(60))) return s.slice(0, 120); // 小なり記号も弾く
  }
  return null;
}

export type WpPageLite = { id: number; slug: string; parent: number; link: string };

/** slug+parent でページを探す（lang指定可）。無ければ null */
export async function findPage(slug: string, parent: number, lang?: string): Promise<WpPageLite | null> {
  const langQ = lang ? `&lang=${lang}` : "";
  const res = await wpFetch(`/pages?slug=${encodeURIComponent(slug)}${langQ}&_fields=id,slug,parent,link&per_page=10`);
  const list = await readJson<WpPageLite[]>(res, `WPページ検索(${slug})`);
  return list.find((p) => p.parent === parent) ?? null;
}

/**
 * 親ページ（/tuning/ と /tuning/{brandSlug}/）を**言語別に**用意して brand 親の ID を返す。
 * Polylangは言語ごとに別ページ＝JPツリー(lang=ja)とENツリー(lang=en)は独立。
 * ENのルート /en/tuning/ は既存の紹介ページ(ECU & TCU Tuning)をそのまま親に使う。
 */
export async function ensureParentPage(
  brandSlug: string,
  brandTitle: string,
  lang: "ja" | "en",
  apply: boolean,
): Promise<{ brandId: number | null; created: string[] }> {
  const created: string[] = [];
  const prefix = lang === "en" ? "/en" : "";
  let tuning = await findPage("tuning", 0, lang);
  if (!tuning) {
    if (!apply) return { brandId: null, created: [`${prefix}/tuning/`] };
    tuning = await createPage({
      slug: "tuning",
      parent: 0,
      title: lang === "en" ? "Tuning Data by Model" : "車種別チューニングデータ",
      content: "",
      status: "publish",
      lang,
    });
    created.push(`${prefix}/tuning/`);
  }
  let brand = await findPage(brandSlug, tuning.id, lang);
  if (!brand) {
    if (!apply) return { brandId: null, created: [...created, `${prefix}/tuning/${brandSlug}/`] };
    brand = await createPage({ slug: brandSlug, parent: tuning.id, title: brandTitle, content: "", status: "publish", lang });
    created.push(`${prefix}/tuning/${brandSlug}/`);
  }
  return { brandId: brand.id, created };
}

export type CreatePageInput = {
  slug: string;
  parent: number;
  title: string;
  content: string;
  status: "draft" | "publish";
  lang: "ja" | "en";
  translationOfJp?: number; // Polylang: JPページIDとの紐付け（EN作成時）
};

export async function createPage(input: CreatePageInput): Promise<WpPageLite> {
  const body: Record<string, unknown> = {
    slug: input.slug,
    parent: input.parent,
    title: input.title,
    content: input.content,
    status: input.status,
  };
  body.lang = input.lang;
  if (input.lang === "en" && input.translationOfJp) body.translations = { ja: input.translationOfJp };
  const res = await wpFetch(`/pages`, { method: "POST", body: JSON.stringify(body) });
  const page = await readJson<WpPageLite>(res, `WPページ作成(${input.slug})`);
  return page;
}

export async function fetchPageRaw(pageId: number): Promise<{ id: number; raw: string; status: string }> {
  const res = await wpFetch(`/pages/${pageId}?context=edit&_fields=id,status,content.raw`);
  const data = await readJson<{ id: number; status: string; content: { raw: string } }>(res, `WPページ取得(${pageId})`);
  return { id: data.id, raw: data.content.raw, status: data.status };
}

export async function updatePage(pageId: number, fields: { content?: string; title?: string; status?: "draft" | "publish" }): Promise<void> {
  const res = await wpFetch(`/pages/${pageId}`, { method: "POST", body: JSON.stringify(fields) });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`WPページ更新(${pageId}): HTTP ${res.status} ${body.slice(0, 200)}`);
  }
}

/** 既存本文のマーカー区間を新しい生成結果（マーカー含む全体）で差し替える。区間が無ければ全文を生成結果にする */
export function replaceMarkedRegion(currentRaw: string, generatedWhole: string): { next: string; hadRegion: boolean } {
  const s = currentRaw.indexOf(VPAGE_MARK_START);
  const e = currentRaw.indexOf(VPAGE_MARK_END);
  if (s === -1 || e === -1 || e < s) return { next: generatedWhole, hadRegion: false };
  const genS = generatedWhole.indexOf(VPAGE_MARK_START);
  const genE = generatedWhole.indexOf(VPAGE_MARK_END) + VPAGE_MARK_END.length;
  const region = generatedWhole.slice(genS, genE);
  const next = currentRaw.slice(0, s) + region + currentRaw.slice(e + VPAGE_MARK_END.length);
  return { next, hadRegion: true };
}
