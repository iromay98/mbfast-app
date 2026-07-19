// mbPIT 公開パイプライン: 画像処理 → ガード → AI記事生成 → WordPress公開 → 記録・通知。
// ロジックは全部サーバー側に置き、プロンプトや公開ルールの変更をアプリ更新なしで回せるようにする。

import { prisma } from "@/lib/db";
import { storage } from "@/server/storage";
import { notify } from "@/server/notifications";
import { processPhoto, seoFilename } from "./images";
import { runGuard, CAUTION_HTML } from "./guard";
import { generateArticle, CATEGORY_LABELS } from "./generate";
import { uploadMedia, publishPost, MBPIT_PARENT_CATEGORY_ID, type WpMedia } from "./wordpress";

export type PitPublishResult =
  | { status: "published"; postId: string; url: string; title: string }
  | { status: "held"; postId: string; reasons: string[] }
  | { status: "failed"; postId: string; error: string };

type StoreInfo = {
  id: string;
  displayName: string;
  slug: string;
  wpCategoryId: number;
  footerHtml: string;
  faqJson: unknown;
};

export async function runPitPipeline(opts: {
  store: StoreInfo;
  vehicle: string;
  category: string; // ecu | coating | polish | maintenance | other
  memo: string | null;
  photos: { buffer: Buffer }[];
}): Promise<PitPublishResult> {
  const { store } = opts;

  // 1. 画像処理（リサイズ・JPEG化。プレートぼかしはPhase 4でここに入る）
  const processed = [];
  for (const p of opts.photos) {
    processed.push(await processPhoto(p.buffer));
  }
  const plateLog = processed.map((p, i) => ({ index: i, plateDetected: p.plateDetected }));

  // 2. コンテンツガード
  const guard = runGuard(opts.vehicle, opts.memo);

  // 投稿レコード（写真はストレージへ保存して監査可能に）
  const photoKeys: string[] = [];
  for (let i = 0; i < processed.length; i++) {
    const key = `pit/${store.id}/${Date.now()}-${i}.jpg`;
    await storage.save(key, processed[i].buffer, "image/jpeg");
    photoKeys.push(key);
  }

  const post = await prisma.pitPost.create({
    data: {
      storeId: store.id,
      vehicle: opts.vehicle,
      category: opts.category,
      memo: opts.memo,
      photoKeys,
      plateLog,
      status: "processing",
      guardResult: [
        ...guard.blockReasons.map((r) => `ブロック: ${r}`),
        ...guard.cautionReasons.map((r) => `注意書き: ${r}`),
        ...guard.notes,
      ].join(" / ") || null,
    },
  });

  // 2b. ブロック該当 → held 保存＋本店通知のみ（記事は生成しない）
  if (guard.blocked) {
    await prisma.pitPost.update({ where: { id: post.id }, data: { status: "held" } });
    await notify({
      type: "PIT_HELD",
      title: "mbPIT投稿を保留しました",
      message: `${store.displayName} / ${opts.vehicle}: ${guard.blockReasons.join("・")}`,
      dealerId: null,
      link: "/hq/pit",
    });
    return { status: "held", postId: post.id, reasons: guard.blockReasons };
  }

  try {
    // 3. AI記事生成
    const dateYmd = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }).replace(/-/g, "");
    const article = await generateArticle({
      storeName: store.displayName,
      storeSlug: store.slug,
      vehicle: opts.vehicle,
      categoryLabel: CATEGORY_LABELS[opts.category] ?? opts.category,
      memo: guard.cleanedMemo,
      photos: processed.map((p) => p.buffer),
      dateYmd,
    });

    // 4. 画像アップロード（SEOファイル名: {車種ローマ字}-{施工slug}-{連番}.jpg）
    const baseSlug = `${article.vehicle_romaji}-${article.treatment_slug}`;
    const medias: WpMedia[] = [];
    for (let i = 0; i < processed.length; i++) {
      medias.push(
        await uploadMedia(processed[i].buffer, seoFilename(baseSlug, i), article.image_alts[i] ?? ""),
      );
    }

    // 5. 本文合成: プレースホルダ→実画像、未使用画像は末尾に追加、注意書き・FAQ・店舗フッターを結合
    let body = article.body_html;
    const used = new Set<number>();
    for (let i = 0; i < medias.length; i++) {
      const ph = new RegExp(`\\{\\{\\s*IMAGE_${i + 1}\\s*\\}\\}`, "g");
      if (ph.test(body)) {
        body = body.replace(ph, imageBlock(medias[i]));
        used.add(i);
      }
    }
    body = body.replace(/\{\{\s*IMAGE_\d+\s*\}\}/g, ""); // 余ったプレースホルダは除去
    for (let i = 0; i < medias.length; i++) {
      if (!used.has(i)) body += `\n${imageBlock(medias[i])}`;
    }
    if (guard.cautionNeeded) body += `\n<!-- wp:paragraph -->${CAUTION_HTML}<!-- /wp:paragraph -->`;
    body += renderFaq(store.faqJson);
    if (store.footerHtml.trim()) body += `\n${store.footerHtml}`;

    // 6. 公開（店舗カテゴリ＋親カテゴリ545。既存の「代理店」カテゴリツリーには絶対に触れない）
    const wpPost = await publishPost({
      title: article.title,
      slug: article.slug,
      contentHtml: body,
      categoryIds: [store.wpCategoryId, MBPIT_PARENT_CATEGORY_ID],
      featuredMediaId: medias[0]?.id,
      metaDescription: article.meta_description,
      focusKeyword: article.focus_keyword,
    });

    await prisma.pitPost.update({
      where: { id: post.id },
      data: { status: "published", title: article.title, wpPostId: wpPost.id, publishedUrl: wpPost.link },
    });
    await notify({
      type: "PIT_PUBLISHED",
      title: "施工記録がブログに公開されました",
      message: article.title,
      dealerId: null,
      link: wpPost.link,
    });
    return { status: "published", postId: post.id, url: wpPost.link, title: article.title };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.pitPost.update({
      where: { id: post.id },
      data: { status: "failed", errorMessage: msg.slice(0, 1000) },
    });
    return { status: "failed", postId: post.id, error: msg };
  }
}

// Gutenberg画像ブロック
function imageBlock(m: WpMedia): string {
  return (
    `<!-- wp:image {"id":${m.id},"sizeSlug":"large","linkDestination":"none"} -->` +
    `<figure class="wp-block-image size-large"><img src="${m.sourceUrl}" alt="" class="wp-image-${m.id}"/></figure>` +
    `<!-- /wp:image -->`
  );
}

// 店舗マスタのFAQ（[{q,a}]）→ 末尾FAQブロック（AIO対策）。無ければ何も出さない。
function renderFaq(faqJson: unknown): string {
  if (!Array.isArray(faqJson)) return "";
  const items = faqJson.filter(
    (x): x is { q: string; a: string } =>
      !!x && typeof x === "object" && typeof (x as { q?: unknown }).q === "string" && typeof (x as { a?: unknown }).a === "string",
  );
  if (items.length === 0) return "";
  const rows = items
    .map(
      (f) =>
        `<!-- wp:paragraph --><p><strong>Q. ${escapeHtml(f.q)}</strong><br>A. ${escapeHtml(f.a)}</p><!-- /wp:paragraph -->`,
    )
    .join("\n");
  return `\n<!-- wp:heading --><h2>よくあるご質問</h2><!-- /wp:heading -->\n${rows}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
