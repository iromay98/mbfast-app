// mbPIT 公開パイプライン: 画像処理 → ガード → AI記事生成 → WordPress公開 → 記録・通知。
// ロジックは全部サーバー側に置き、プロンプトや公開ルールの変更をアプリ更新なしで回せるようにする。

import { prisma } from "@/lib/db";
import { storage } from "@/server/storage";
import { notify } from "@/server/notifications";
import { processPhoto, seoFilename, PIT_IMAGE_MIME } from "./images";
import { runGuard, CAUTION_HTML } from "./guard";
import { generateArticle, CATEGORY_LABELS, MBPIT_HUB_URL, storePageUrl } from "./generate";
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
  // 施工動画（任意・1本）。バブリング等のサウンド系で効果大。
  // ぼかし加工は行わない（映り込みは投稿者の確認責任・フォームに注意書きあり）
  video?: { buffer: Buffer; type: string } | null;
  vehicleId?: string | null; // 車検証QRで紐づけた車両（お薬手帳）
}): Promise<PitPublishResult> {
  const { store } = opts;

  // 1. 画像処理（リサイズ・WebP化・EXIF除去。プレートぼかしはPhase 4でここに入る）
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
    const key = `pit/${store.id}/${Date.now()}-${i}.webp`;
    await storage.save(key, processed[i].buffer, PIT_IMAGE_MIME);
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
      vehicleId: opts.vehicleId ?? null,
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
    const isoDate = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }); // "2026-07-19"
    const dateYmd = isoDate.replace(/-/g, "");
    const [y, m, d] = isoDate.split("-").map(Number);
    const faqItems = Array.isArray(store.faqJson)
      ? (store.faqJson as unknown[]).filter(
          (x): x is { q: string; a: string } =>
            !!x && typeof x === "object" && typeof (x as { q?: unknown }).q === "string" && typeof (x as { a?: unknown }).a === "string",
        )
      : [];
    const article = await generateArticle({
      storeName: store.displayName,
      storeSlug: store.slug,
      vehicle: opts.vehicle,
      categoryLabel: CATEGORY_LABELS[opts.category] ?? opts.category,
      memo: guard.cleanedMemo,
      photos: processed.map((p) => p.buffer),
      dateYmd,
      dateJa: `${y}年${m}月${d}日`,
      faqReference: faqItems,
    });

    // 4. 画像アップロード（WebP。SEOファイル名: {車種ローマ字}-{施工slug}-{連番}.webp）
    const baseSlug = `${article.vehicle_romaji}-${article.treatment_slug}`;
    const medias: WpMedia[] = [];
    for (let i = 0; i < processed.length; i++) {
      medias.push(
        await uploadMedia(processed[i].buffer, seoFilename(baseSlug, i), article.image_alts[i] ?? ""),
      );
    }

    // 4b. 動画アップロード（任意・1本。変換なしでWPメディアへそのまま上げる）
    let videoMedia: WpMedia | null = null;
    if (opts.video) {
      const ext =
        { "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm" }[opts.video.type] ?? "mp4";
      videoMedia = await uploadMedia(
        opts.video.buffer,
        `${baseSlug}-video.${ext}`,
        `${opts.vehicle} 施工動画`,
        opts.video.type || "video/mp4",
      );
    }

    // 5. 本文合成: プレースホルダ→実画像、未使用画像は末尾に追加、動画・注意書き・FAQ・店舗フッターを結合
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
    if (videoMedia) {
      body +=
        `\n<!-- wp:heading {"level":2} --><h2>施工動画</h2><!-- /wp:heading -->` +
        `\n<!-- wp:video --><figure class="wp-block-video"><video controls preload="metadata" src="${videoMedia.sourceUrl}"></video></figure><!-- /wp:video -->`;
    }
    if (guard.cautionNeeded) body += `\n<!-- wp:paragraph -->${CAUTION_HTML}<!-- /wp:paragraph -->`;
    // FAQはAIが本文内に生成（統一フォーマット）。末尾に内部リンク（店舗ページ＋mbPITハブ）→店舗フッター
    body +=
      `\n<!-- wp:paragraph --><p>施工店: <a href="${storePageUrl(store.slug)}">${escapeHtml(store.displayName)}</a>` +
      `　/　<a href="${MBPIT_HUB_URL}">mbPIT施工記録一覧</a></p><!-- /wp:paragraph -->`;
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

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
