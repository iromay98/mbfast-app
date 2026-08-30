/*
 * mbFAST本店GBP「最新情報」への過去ブログ記事ドリップ投稿。
 *
 * 狙い: GBPの投稿は約7日で一覧から薄れる。過去記事のストック(300件超)を
 * 毎朝1件ずつ流し続けることで、プロフィールが常に動いている状態を保つ。
 * **必ず1日1件**（大量一括はスパム判定・審査落ちの元）。
 *
 * 実行: GitHub Actions の cron（毎朝6時JST）→ SSH → `npm run gbp:drip`。
 * 二重投稿防止は GbpDripPost.wpPostId（unique）が唯一の台帳。
 *
 * 対象の絞り方（mbPIT過去記事バックフィルと同じ思想）:
 * - カテゴリ339（施工事例）配下の publish 記事、新しい順
 * - 代理店カテゴリ（355,367,371,335,491,713,697,286,368,876）は除外
 *   ＝他店の施工を本店のマップで宣伝しない
 * - AdBlue/DPF/EGR（362）は除外（規制グレー領域はマップに出さない）
 * - mbPIT複製記事（カテゴリ545配下）も除外（本店ブログ原本だけを流す）
 */
import Anthropic from "@anthropic-ai/sdk";
import sharp from "sharp";
import { prisma } from "@/lib/db";
import { storage } from "@/server/storage";
import { createLocalPost } from "@/server/pit/gbp/client";
import { publicPhotoUrl } from "@/server/pit/photo-public";
import { notify } from "@/server/notifications";

const WP = "https://mbfasttuning.com/wp-json/wp/v2";
const UA = { "User-Agent": "curl/8.4.0" };
const EXCLUDE_CATS = new Set([355, 367, 371, 335, 491, 713, 697, 286, 368, 876, 362, 545]);

type WpPost = {
  id: number;
  link: string;
  title: { rendered: string };
  excerpt: { rendered: string };
  categories: number[];
  featured_media: number;
};

async function wpJson<T>(url: string): Promise<T> {
  const r = await fetch(url, { headers: UA });
  const t = await r.text();
  return JSON.parse(t.slice(t.search(/[[{]/))) as T;
}

const strip = (html: string) => html.replace(/<[^>]+>/g, "").replace(/&[a-z#0-9]+;/g, " ").trim();

/** 次に投稿すべき記事を1件選ぶ（未投稿・除外カテゴリなし・新しい順） */
async function pickArticle(): Promise<WpPost | null> {
  const done = new Set(
    (await prisma.gbpDripPost.findMany({ select: { wpPostId: true } })).map((r) => r.wpPostId),
  );
  for (let page = 1; page <= 8; page++) {
    const posts = await wpJson<WpPost[]>(
      `${WP}/posts?categories=339&per_page=50&page=${page}&_fields=id,link,title,excerpt,categories,featured_media`,
    );
    if (!Array.isArray(posts) || posts.length === 0) break;
    for (const p of posts) {
      if (done.has(p.id)) continue;
      if (p.categories.some((c) => EXCLUDE_CATS.has(c))) continue;
      return p;
    }
  }
  return null;
}

/** マップ用の清書文（200〜350字・場所/人物描写なし・です・ます調） */
async function writeMapText(title: string, excerpt: string): Promise<string> {
  const client = new Anthropic();
  const res = await client.messages.create({
    model: "claude-sonnet-4-5",
    max_tokens: 500,
    messages: [
      {
        role: "user",
        content: `自動車チューニング店のGoogleマップ投稿文を1つ書いてください。過去の施工事例の紹介です。
条件: 200〜350字。です・ます調。車種と施工内容から書き始める。走行場所の地名・道路名・施設名・人物描写は書かない。誇張しない。ハッシュタグ・絵文字なし。本文のみを出力。
記事タイトル: ${title}
記事抜粋: ${excerpt.slice(0, 500)}`,
      },
    ],
  });
  const text = res.content[0]?.type === "text" ? res.content[0].text.trim() : "";
  if (!text) throw new Error("清書文の生成に失敗");
  return text;
}

/** アイキャッチをサーバ側で取得し、アプリ配信キー(pit/配下)に保存してURL化 */
async function preparePhoto(mediaId: number, wpId: number): Promise<string | null> {
  if (!mediaId) return null;
  try {
    const m = await wpJson<{ source_url?: string }>(`${WP}/media/${mediaId}?_fields=source_url`);
    if (!m.source_url) return null;
    const img = await fetch(m.source_url, { headers: UA });
    if (!img.ok) return null;
    const buf = Buffer.from(await img.arrayBuffer());
    const jpeg = await sharp(buf).jpeg({ quality: 88 }).toBuffer();
    const key = `pit/drip/${wpId}.jpg`;
    await storage.save(key, jpeg, "image/jpeg");
    return publicPhotoUrl(key);
  } catch {
    return null; // 写真は無くても投稿する（文章を道連れにしない）
  }
}

export async function runGbpDrip(): Promise<string> {
  const store = await prisma.pitStore.findFirst({
    where: { slug: "mbfast-tuning" },
    select: { gbpAccountId: true, gbpLocationId: true, gbpPostingEnabled: true },
  });
  if (!store?.gbpLocationId || !store.gbpPostingEnabled) {
    return "本店のGBP連携が無効のためスキップ";
  }
  const article = await pickArticle();
  if (!article) return "未投稿の過去記事がありません（全件消化）";

  const title = strip(article.title.rendered);
  try {
    const text = await writeMapText(title, strip(article.excerpt.rendered));
    const photoUrl = await preparePhoto(article.featured_media, article.id);
    const summary = `${text}\n\n施工の詳細は記録ページでご覧いただけます。`;
    let post;
    try {
      post = await createLocalPost(
        store.gbpAccountId,
        store.gbpLocationId,
        { summary, cta: { type: "LEARN_MORE", url: article.link }, ...(photoUrl ? { photoUrl } : {}) },
      );
    } catch (e) {
      if (!photoUrl) throw e;
      // 写真で落ちたら文章だけで出す（新規投稿と同じフォールバック方針）
      post = await createLocalPost(store.gbpAccountId, store.gbpLocationId, {
        summary,
        cta: { type: "LEARN_MORE", url: article.link },
      });
    }
    await prisma.gbpDripPost.create({
      data: { wpPostId: article.id, title, gbpPostName: post.name ?? "" },
    });
    await notify({
      type: "PIT_PUBLISHED",
      title: "過去記事をGoogleマップに投稿しました",
      message: `${title}（記事ID ${article.id}）`,
      dealerId: null,
      link: "/hq/pit/gbp",
    });
    return `投稿: ${title}`;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // 失敗も台帳に記録し、同じ記事で毎朝つまずき続けないようにする
    await prisma.gbpDripPost.create({
      data: { wpPostId: article.id, title, error: msg.slice(0, 500) },
    });
    await notify({
      type: "PIT_PUBLISHED",
      title: "過去記事のマップ投稿に失敗",
      message: `${title}: ${msg.slice(0, 200)}`,
      dealerId: null,
      link: "/hq/pit/gbp",
    });
    return `失敗: ${title}: ${msg}`;
  }
}
