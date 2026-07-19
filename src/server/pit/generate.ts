// mbPIT AI記事生成。Claude APIに写真＋メタデータを渡し、構造化出力(JSON Schema)で記事一式を受け取る。
// 本文中の画像位置は {{IMAGE_n}} プレースホルダで受け、アップロード後にサーバー側で実URLに置換する。

import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.PIT_ARTICLE_MODEL ?? "claude-opus-4-8";

export function pitAiEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export const CATEGORY_LABELS: Record<string, string> = {
  ecu: "ECUチューニング",
  coating: "コーティング",
  polish: "磨き",
  maintenance: "メンテナンス",
  other: "その他",
};

export type GeneratedArticle = {
  title: string;
  slug: string;
  body_html: string; // {{IMAGE_1}}..{{IMAGE_n}} プレースホルダ入り
  meta_description: string;
  focus_keyword: string;
  vehicle_romaji: string; // 画像ファイル名用（例: alphard30）
  treatment_slug: string; // 画像ファイル名用（例: ceramic-coating）
  image_alts: string[];
};

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", description: "SEOタイトル。基本形: {車種} {施工内容}｜{店舗名}" },
    slug: { type: "string", description: "英小文字とハイフンのみ。{車種ローマ字}-{施工slug}-{店舗slug}-{YYYYMMDD}" },
    body_html: {
      type: "string",
      description:
        "Gutenbergブロック互換HTML（<!-- wp:paragraph --> 等）。写真の位置には {{IMAGE_1}} のようなプレースホルダを単独ブロックとして配置する",
    },
    meta_description: { type: "string", description: "120文字以内" },
    focus_keyword: { type: "string", description: "例: アルファード コーティング" },
    vehicle_romaji: { type: "string", description: "車種のローマ字slug（例: alphard30）" },
    treatment_slug: { type: "string", description: "施工内容の英語slug（例: ceramic-coating）" },
    image_alts: { type: "array", items: { type: "string" }, description: "写真と同数。日本語で内容を説明" },
  },
  required: [
    "title", "slug", "body_html", "meta_description", "focus_keyword",
    "vehicle_romaji", "treatment_slug", "image_alts",
  ],
  additionalProperties: false,
} as const;

export type GenerateInput = {
  storeName: string;
  storeSlug: string;
  vehicle: string;
  categoryLabel: string;
  memo: string; // ガード後のクリーン済みテキスト
  photos: Buffer[]; // 処理済みJPEG
  dateYmd: string; // "20260719"
};

const SYSTEM = `あなたは自動車チューニング・ディテイリング企業「mbFAST Tuning」のブログ編集者です。
加盟店(mbPIT)の施工報告を、公式ブログ記事に仕上げます。

記事の型（厳守）:
- 文体: です・ます調。短文中心。施工事例アーク（お預かり → 施工内容 → 仕上がり → 問い合わせの誘い）
- 分量: 800〜1200字
- 冒頭2〜3文で「車種＋施工内容＋結果」を完結に要約する（AI検索の引用に拾われやすい形）
- 写真は本文中に分散配置する。写真の位置には {{IMAGE_1}} {{IMAGE_2}} … のプレースホルダを、それぞれ独立したブロックとして置く（渡された写真の枚数分すべて使う）
- 本文はGutenbergブロック互換HTML: 段落は <!-- wp:paragraph --><p>…</p><!-- /wp:paragraph -->、見出しは <!-- wp:heading --><h2>…</h2><!-- /wp:heading -->
- 具体的なセッティング値・使用薬剤の製品名などの企業秘密レベルの詳細は書かない（「詳しいセッティングの中身は企業秘密です」型のぼかしでよい）
- 個人名・電話番号・ナンバープレートの数字は絶対に書かない
- 店舗紹介・問い合わせボタンはサーバー側で末尾に結合するので本文には書かない（「お気軽にお問い合わせください」程度の締めの一文はOK）
- メモが空でも写真と車種・施工カテゴリから自然な記事を書く。事実の捏造（具体的な数値・作業時間・価格など根拠のない情報）はしない`;

export async function generateArticle(input: GenerateInput): Promise<GeneratedArticle> {
  const client = new Anthropic();

  const imageBlocks = input.photos.map((buf) => ({
    type: "image" as const,
    source: {
      type: "base64" as const,
      media_type: "image/jpeg" as const,
      data: buf.toString("base64"),
    },
  }));

  const prompt = [
    `以下の施工情報と写真${input.photos.length}枚からブログ記事を生成してください。`,
    ``,
    `店舗名: ${input.storeName}`,
    `店舗slug: ${input.storeSlug}`,
    `車種: ${input.vehicle}`,
    `施工カテゴリ: ${input.categoryLabel}`,
    `施工メモ: ${input.memo || "（なし）"}`,
    `公開日: ${input.dateYmd}`,
    ``,
    `slugは {車種ローマ字}-{施工slug}-${input.storeSlug}-${input.dateYmd} の形式にすること。`,
    `image_alts は写真と同じ ${input.photos.length} 件にすること。`,
  ].join("\n");

  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 16000,
    thinking: { type: "adaptive" },
    system: SYSTEM,
    output_config: { format: { type: "json_schema", schema: SCHEMA } },
    messages: [{ role: "user", content: [...imageBlocks, { type: "text", text: prompt }] }],
  });

  if (response.stop_reason === "refusal") {
    throw new Error("AIが記事生成を拒否しました（内容を見直してください）");
  }
  const text = response.content.find((b) => b.type === "text")?.text;
  if (!text) throw new Error("AIから記事が返りませんでした");
  const article = JSON.parse(text) as GeneratedArticle;

  // 最低限のサニティ: slugを正規化し、店舗slugと日付が欠けていれば補う
  let slug = article.slug.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!slug.includes(input.storeSlug)) slug = `${slug}-${input.storeSlug}`;
  if (!slug.includes(input.dateYmd)) slug = `${slug}-${input.dateYmd}`;
  article.slug = slug;

  // image_alts の数を写真数に合わせる（不足はvehicleで補完）
  while (article.image_alts.length < input.photos.length) {
    article.image_alts.push(`${input.vehicle} の施工写真`);
  }
  article.image_alts = article.image_alts.slice(0, input.photos.length);

  return article;
}
