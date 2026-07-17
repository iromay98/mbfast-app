import Anthropic from "@anthropic-ai/sdk";
import { PIT_CATEGORY_LABELS, PIT_CATEGORY_SLUGS, type PitCategoryKey } from "@/lib/pit-labels";

/*
 * mbPIT AI記事生成。1回の Claude 呼び出しで記事一式(JSON)を返させる。
 * 写真の挿入位置は AI に [image:n] プレースホルダで指定させ、
 * WordPress へのアップロード後にサーバー側で Gutenberg 画像ブロックへ置換する
 * （AI に未知の URL を書かせない）。
 * 店舗フッターは DB の定型 HTML をサーバー側で結合する（AI に毎回生成させない）。
 */

export type GeneratedArticle = {
  title: string;
  slugBase: string; // 車種ローマ字＋施工slug（店舗slug・日付はサーバー側で付与）
  bodyHtml: string; // Gutenberg ブロック互換 HTML（[image:n] プレースホルダ入り）
  metaDescription: string;
  focusKeyword: string;
  imageFilenames: string[]; // SEO用ファイル名（拡張子なしでも可・サーバーで正規化）
  imageAlts: string[];
};

const ARTICLE_MODEL = process.env.PIT_ARTICLE_MODEL ?? "claude-sonnet-5";

const ARTICLE_TOOL: Anthropic.Tool = {
  name: "report_article",
  description: "Report the generated Japanese blog article for the vehicle service record.",
  input_schema: {
    type: "object",
    properties: {
      title: {
        type: "string",
        description:
          "SEO title based on the pattern `{車種} {施工内容}｜{店舗名}` (Japanese).",
      },
      slug_base: {
        type: "string",
        description:
          "URL slug base: romanized vehicle + service slug, lowercase ascii and hyphens only, e.g. 'alphard30-ceramic-coating'. Do NOT include store name or date.",
      },
      body_html: {
        type: "string",
        description:
          "Article body as Gutenberg-block-compatible HTML (<!-- wp:paragraph -->/<!-- wp:heading --> comments). Insert photo placeholders as standalone lines exactly like [image:1], [image:2] ... distributed through the article. Do NOT write <img> tags.",
      },
      meta_description: {
        type: "string",
        description: "Meta description, 120 Japanese characters or fewer.",
      },
      focus_keyword: {
        type: "string",
        description: "Focus keyphrase for SEO, e.g. 'アルファード コーティング'.",
      },
      image_filenames: {
        type: "array",
        items: { type: "string" },
        description:
          "SEO filename for each photo in order: '{vehicle-romaji}-{service-slug}-{n}.jpg' lowercase ascii, e.g. 'alphard30-ceramic-coating-1.jpg'. Same count as the photo count given.",
      },
      image_alts: {
        type: "array",
        items: { type: "string" },
        description:
          "Japanese alt text describing each photo's likely content in context (vehicle + service). Same count as photo count.",
      },
    },
    required: [
      "title",
      "slug_base",
      "body_html",
      "meta_description",
      "focus_keyword",
      "image_filenames",
      "image_alts",
    ],
  },
};

function buildPrompt(opts: {
  vehicle: string;
  category: PitCategoryKey;
  memo: string;
  storeName: string;
  photoCount: number;
  footerHtml: string;
}): string {
  const categoryLabel = PIT_CATEGORY_LABELS[opts.category];
  return [
    "あなたは自動車チューニング/ディテイリング店の施工事例ブログ記事を書くプロのライターです。",
    "以下の施工記録から、mbfasttuning.com に公開する日本語のブログ記事を1本生成してください。",
    "",
    `車種: ${opts.vehicle}`,
    `施工カテゴリ: ${categoryLabel}`,
    `店舗名: ${opts.storeName}`,
    `店舗スタッフのメモ: ${opts.memo || "（メモなし）"}`,
    `写真の枚数: ${opts.photoCount}枚`,
    "",
    "記事の要件:",
    `- タイトル: 「{車種} {施工内容}｜${opts.storeName}」を基本形にした自然なSEOタイトル`,
    "- 文体: です・ます調。短文中心。施工事例のアーク（お預かり → 施工内容 → 仕上がり → お問い合わせの誘い）で構成",
    "- 分量: 800〜1200字目安",
    "- AIO対策: 冒頭の2〜3文で「車種＋施工内容＋結果」を完結に要約する（AI検索の引用に拾われやすい形）",
    "- 写真プレースホルダ [image:1] 〜 [image:" +
      opts.photoCount +
      "] を本文中に分散配置する（各1回・行として単独で置く。<img>タグは書かない）",
    "- Gutenbergブロック互換HTMLで書く: 段落は <!-- wp:paragraph --><p>…</p><!-- /wp:paragraph -->、見出しは <!-- wp:heading --><h2>…</h2><!-- /wp:heading --> の形式",
    "- 具体的なセッティング値・使用薬剤の製品名など企業秘密レベルの詳細は書かない（必要なら「詳しいセッティングの中身は企業秘密です」のようにぼかす）",
    "- メモに含まれる個人名・電話番号・車台番号などの個人情報は本文に一切書かない",
    "- 法令・車検適合を保証する断定表現はしない",
    opts.footerHtml
      ? "- 以下は店舗紹介フッター（サーバー側で記事末尾に自動結合するので本文には含めない）。この中に営業時間・料金目安などの情報があれば、本文末尾に FAQ 2問（例: 施工時間の目安・料金の目安）を <!-- wp:heading --><h2>よくあるご質問</h2><!-- /wp:heading --> セクションとして追加してよい。情報が無ければFAQは省略する。\n---フッター参考データ---\n" +
        opts.footerHtml +
        "\n---"
      : "- FAQセクションは不要",
    "",
    "また、SEO用に写真ファイル名（車種ローマ字-施工slug-連番.jpg）と各写真のalt文（日本語）も生成してください。",
    `施工slugの例: ${PIT_CATEGORY_SLUGS[opts.category]}（施工内容がより具体的なら具体的なslugでよい）`,
    "",
    "report_article を呼び出して結果を返してください。",
  ].join("\n");
}

const ASCII_SLUG_RE = /[^a-z0-9-]+/g;

export function sanitizeSlug(s: string, fallback: string): string {
  const out = s
    .toLowerCase()
    .replace(/[\s_]+/g, "-")
    .replace(ASCII_SLUG_RE, "")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "");
  return out || fallback;
}

/** AI出力のファイル名を正規化（ascii slug + .jpg、必ず photoCount 個返す） */
export function normalizeFilenames(
  names: string[],
  photoCount: number,
  slugBase: string,
): string[] {
  const out: string[] = [];
  for (let i = 0; i < photoCount; i++) {
    const raw = names[i] ?? "";
    const base = sanitizeSlug(raw.replace(/\.jpe?g$/i, ""), `${slugBase}-${i + 1}`);
    // 連番が落ちていたら付与して衝突を防ぐ
    const withSeq = out.includes(`${base}.jpg`) || !/\d$/.test(base) ? `${base}-${i + 1}` : base;
    out.push(`${withSeq}.jpg`.replace(/--+/g, "-"));
  }
  return out;
}

export async function generateArticle(opts: {
  vehicle: string;
  category: PitCategoryKey;
  memo: string;
  storeName: string;
  photoCount: number;
  footerHtml: string;
}): Promise<GeneratedArticle> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY が未設定のため記事を生成できません");
  const client = new Anthropic({ apiKey });

  const msg = await client.messages.create({
    model: ARTICLE_MODEL,
    max_tokens: 4000,
    tools: [ARTICLE_TOOL],
    tool_choice: { type: "tool", name: "report_article" },
    messages: [{ role: "user", content: buildPrompt(opts) }],
  });
  const block = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!block) throw new Error("記事生成の応答が不正です（tool_use なし）");
  const inp = block.input as Record<string, unknown>;

  const title = String(inp.title ?? "").trim();
  const bodyHtml = String(inp.body_html ?? "").trim();
  if (!title || !bodyHtml) throw new Error("記事生成の応答が不完全です（title/body欠落）");

  const fallbackSlug = PIT_CATEGORY_SLUGS[opts.category];
  const slugBase = sanitizeSlug(String(inp.slug_base ?? ""), fallbackSlug);
  const metaDescription = String(inp.meta_description ?? "").trim().slice(0, 120);
  const focusKeyword = String(inp.focus_keyword ?? "").trim();
  const rawNames = Array.isArray(inp.image_filenames) ? inp.image_filenames.map(String) : [];
  const rawAlts = Array.isArray(inp.image_alts) ? inp.image_alts.map(String) : [];

  const imageFilenames = normalizeFilenames(rawNames, opts.photoCount, slugBase);
  const imageAlts = Array.from(
    { length: opts.photoCount },
    (_, i) => (rawAlts[i] ?? "").trim() || `${opts.vehicle}の${PIT_CATEGORY_LABELS[opts.category]}施工写真`,
  );

  return { title, slugBase, bodyHtml, metaDescription, focusKeyword, imageFilenames, imageAlts };
}
