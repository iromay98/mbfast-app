// mbPIT AI記事生成。Claude APIに写真＋メタデータを渡し、構造化出力(JSON Schema)で記事一式を受け取る。
// 本文中の画像位置は {{IMAGE_n}} プレースホルダで受け、アップロード後にサーバー側で実URLに置換する。

import Anthropic from "@anthropic-ai/sdk";

// コスト重視でsonnetを既定に（本部仕様）。PIT_ARTICLE_MODEL で上書き可能
const MODEL = process.env.PIT_ARTICLE_MODEL ?? "claude-sonnet-5";

// 店舗ページ・mbPITハブ（記事末尾の内部リンクと車両情報テーブルで使用）
export const MBPIT_HUB_URL = "https://mbfasttuning.com/mbpit/";
export function storePageUrl(storeSlug: string): string {
  return `${MBPIT_HUB_URL}${storeSlug}/`;
}

export function pitAiEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

// 公式8ジャンルのラベル（本部管理・src/config/mbpit-genres.json が単一の正）。
// DBの既存行に残る旧区分(polish/other)のラベルも引ける
export { GENRE_LABELS as CATEGORY_LABELS } from "@/lib/mbpit-genres";

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
    title: { type: "string", description: "タイトル。厳守形式: 【施工記録】{車種} {施工内容}｜{店舗名}" },
    slug: { type: "string", description: "英小文字とハイフンのみ。{車種ローマ字}-{施工slug}-{YYYYMMDD}（店舗名は含めない）" },
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
  memo: string; // ガード後のクリーン済みテキスト（音声書き起こし含む）
  photos: Buffer[]; // 処理済みWebP
  dateYmd: string; // "20260719"
  dateJa: string; // "2026年7月19日"（車両情報テーブル用）
  faqReference?: { q: string; a: string }[]; // 店舗マスタのFAQ（あればFAQ生成の素材にする）
};

const SYSTEM = `あなたは施工記録ポータル「mbPIT」のブログ編集者です。
加盟店の施工報告（音声書き起こし＋写真）を、mbPIT公式の施工記録記事に仕上げます。

文体（厳守）:
- です・ます調。短文中心。事実ベース。宣伝臭・誇張は禁止
- 分量: 800〜1200字
- 音声・メモに含まれない情報を捏造しない（具体的な数値・作業時間・価格など根拠のない情報は書かない。不明な項目は書かない）
- 具体的なマップ名・セッティング値・使用薬剤の製品名など企業秘密レベルの技術詳細は書かない。
  書けないことは**黙って省く**。「企業秘密なので」「お答えできませんが」「詳細は控えますが」のような
  断り文句・言い訳は本文に一切書かない（読者に説明する必要はない。何度も出るとしつこい）。
  技術の中身に触れずに、仕上がり・体感・お客様の反応など書けることだけで文章を成立させる
- 個人名・電話番号・ナンバープレートの数字は絶対に書かない
- 禁止語: 本文・タイトルに「mbFAST」という語を絶対に含めない（mbPITは別ブランドとして運用する）。認定表記が必要な場合は「mbPIT認定店」を使う

構成（統一フォーマット厳守・この順番）:
1. 冒頭1〜2文（店舗名・車種・作業内容の要約。AI検索の引用に拾われやすい形）
2. <!-- wp:heading --><h2>車両情報</h2><!-- /wp:heading --> の直後に、次の形のテーブルを置く（th のstyle属性はこのまま使う。値が不明な行は行ごと省く）:
<!-- wp:table -->
<figure class="wp-block-table"><table><tbody>
<tr><th style="background-color:#1a1a1a;color:#d4af37;">車種</th><td>{車種}</td></tr>
<tr><th style="background-color:#1a1a1a;color:#d4af37;">作業内容</th><td>{作業内容}</td></tr>
<tr><th style="background-color:#1a1a1a;color:#d4af37;">作業日</th><td>{作業日}</td></tr>
<tr><th style="background-color:#1a1a1a;color:#d4af37;">施工店</th><td><a href="{店舗ページURL}">{店舗名}</a></td></tr>
</tbody></table></figure>
<!-- /wp:table -->
3. <h2>作業内容</h2> — 2〜3段落
4. <h2>作業のポイント</h2> — 1〜2段落
5. <h2>よくあるご質問</h2> — Q&Aを2件。各QはH3見出し（<!-- wp:heading {"level":3} --><h3>Q. …</h3><!-- /wp:heading -->）＋回答段落。参考FAQが渡されていればそれを優先的に素材にする

その他:
- 写真は本文中（主に「作業内容」以降）に分散配置する。写真の位置には {{IMAGE_1}} {{IMAGE_2}} … のプレースホルダを、それぞれ独立したブロックとして置く（渡された写真の枚数分すべて使う）
- 本文はGutenbergブロック互換HTML: 段落は <!-- wp:paragraph --><p>…</p><!-- /wp:paragraph -->、見出しは <!-- wp:heading --><h2>…</h2><!-- /wp:heading -->
- 店舗紹介・問い合わせボタン・末尾の内部リンクはサーバー側で結合するので本文には書かない（「お気軽にお問い合わせください」程度の締めの一文はOK）
- タイトルは必ず「【施工記録】{車種} {作業内容}｜{店舗名}」の形式にする
- メモが空でも写真と車種・施工カテゴリから自然な記事を書く`;

export async function generateArticle(input: GenerateInput): Promise<GeneratedArticle> {
  const client = new Anthropic();

  const imageBlocks = input.photos.map((buf) => ({
    type: "image" as const,
    source: {
      type: "base64" as const,
      media_type: "image/webp" as const,
      data: buf.toString("base64"),
    },
  }));

  const faqRef = (input.faqReference ?? [])
    .map((f) => `Q. ${f.q}\nA. ${f.a}`)
    .join("\n");

  const prompt = [
    `以下の施工情報と写真${input.photos.length}枚からブログ記事を生成してください。`,
    ``,
    `店舗名: ${input.storeName}`,
    `店舗slug: ${input.storeSlug}`,
    `店舗ページURL: ${storePageUrl(input.storeSlug)}`,
    `車種: ${input.vehicle}`,
    `施工カテゴリ: ${input.categoryLabel}`,
    `施工メモ（音声書き起こし含む）: ${input.memo || "（なし）"}`,
    `作業日: ${input.dateJa}`,
    faqRef ? `参考FAQ（FAQセクションの素材に使ってよい）:\n${faqRef}` : ``,
    ``,
    `slugは {車種ローマ字}-{施工slug}-${input.dateYmd} の形式にすること（店舗名は入れない。URLのパス側に店舗が入るため冗長になる）。`,
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

  // slugのサニティ（必ず明示指定して公開する。未指定だとWPが日本語タイトルをURLエンコードした長大slugを作る）:
  // 英数字とハイフンのみに正規化。店舗slugは含めない（URLが /mbpit/{店舗短slug}/{slug}/ のため冗長）。
  // AIがうっかり店舗slugを入れてきた場合は除去する。日付が欠けていれば補う。
  // 同日同車種の他店舗投稿とslugが衝突した場合はWPが自動で -2 を付ける（許容仕様）。
  let slug = article.slug.toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (input.storeSlug) {
    slug = slug
      .replace(new RegExp(`(^|-)${input.storeSlug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(-|$)`), "$1")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
  }
  if (!slug.includes(input.dateYmd)) slug = `${slug}-${input.dateYmd}`;
  article.slug = slug;

  // image_alts の数を写真数に合わせる（不足はvehicleで補完）
  while (article.image_alts.length < input.photos.length) {
    article.image_alts.push(`${input.vehicle} の施工写真`);
  }
  article.image_alts = article.image_alts.slice(0, input.photos.length);

  return article;
}
