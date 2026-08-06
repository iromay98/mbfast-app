// mbPIT 公開パイプライン: 画像処理 → ガード → AI記事生成 → WordPress公開 → 記録・通知。
// ロジックは全部サーバー側に置き、プロンプトや公開ルールの変更をアプリ更新なしで回せるようにする。

import { prisma } from "@/lib/db";
import { storage } from "@/server/storage";
import { notify } from "@/server/notifications";
import { processPhoto, seoFilename, PIT_IMAGE_MIME } from "./images";
import { runGuard, CAUTION_HTML } from "./guard";
import { generateArticle, CATEGORY_LABELS, MBPIT_HUB_URL, storePageUrl } from "./generate";
import {
  uploadMedia,
  publishPost,
  MBPIT_PARENT_CATEGORY_ID,
  tagIdsForCategory,
  type WpMedia,
} from "./wordpress";
import { parseVideoUrl, videoEmbedHtml } from "./video-embed";
import { compressVideo } from "./video";

export type PitPublishResult =
  | { status: "published"; postId: string; url: string; title: string }
  | { status: "review"; postId: string; title: string }
  | { status: "held"; postId: string; reasons: string[] }
  | { status: "failed"; postId: string; error: string };

type StoreInfo = {
  id: string;
  displayName: string;
  slug: string;
  wpCategoryId: number;
  footerHtml: string;
  faqJson: unknown;
  /** true なら生成後に公開せず status="review" で止める（店舗が本文を読んでから公開） */
  postReviewRequired?: boolean;
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
  // 動画URL（YouTube等）。容量を食わないので推奨経路。指定時はファイルより優先
  videoUrl?: string | null;
  // 施工日（YYYY-MM-DD・JST）。まとめて投稿するとき実際の作業日を記事に出すため。
  // 未指定は当日。記事の作業日表記とslugの日付に使う（WPの公開日時は投稿時刻のまま）
  workDate?: string | null;
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

  /*
   * 2b. 規制関連ワード（排ガスデバイス無効化等）の扱い。
   * 以前は held（本部確認まで公開しない）だったが、本部の判断で**止めない**運用に変更した。
   * 公開はそのまま進め、注意書きを必ず挿し、本部には事後のお知らせだけ送る
   * （guardResult には従来どおり検知内容が残る＝後から追える）。
   */
  if (guard.blocked) {
    guard.cautionNeeded = true; // 記事末尾に定型の注意文言を必ず入れる
    await notify({
      type: "PIT_HELD",
      title: "mbPIT投稿に規制関連ワードがあります（公開は止めていません）",
      message: `${store.displayName} / ${opts.vehicle}: ${guard.blockReasons.join("・")}`,
      dealerId: null,
      link: "/hq/pit",
    });
  }

  try {
    // 3. AI記事生成（施工日: 指定があればその日付、なければ当日JST）
    const isoDate =
      opts.workDate ?? new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }); // "2026-07-19"
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

    // 4b. 動画（任意）。URL指定（YouTube等）があればそれを優先し、ファイルは上げない
    //     （自前サーバーの容量を使わない・スマホ回線でも再生が軽い）
    const parsedVideoUrl = opts.videoUrl ? parseVideoUrl(opts.videoUrl) : null;
    const embedHtml =
      parsedVideoUrl && parsedVideoUrl.kind !== "unsupported" ? videoEmbedHtml(parsedVideoUrl) : "";
    let videoMedia: WpMedia | null = null;
    if (!embedHtml && opts.video) {
      // 720p/H.264へ圧縮してからWPへ（失敗時は無圧縮のまま上がる）
      const v = await compressVideo(opts.video.buffer, opts.video.type);
      videoMedia = await uploadMedia(
        v.buffer,
        `${baseSlug}-video.${v.ext}`,
        `${opts.vehicle} 施工動画`,
        v.mime,
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
    if (embedHtml) {
      body += `\n${embedHtml}`;
    } else if (videoMedia) {
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

    /*
     * 6. WordPressへ投稿（店舗カテゴリ＋親カテゴリ545。既存の「代理店」カテゴリツリーには絶対に触れない）
     *
     * 店舗が「公開前に内容を確認する」設定なら、ここでは **下書き**として作り、
     * PitPost.status="review" で止める。店舗が本文を読んで承認すると publish に切り替わる
     * （lib/actions/pit-posts.ts の approveMyPitPost）。
     */
    const review = store.postReviewRequired === true;
    const wpPost = await publishPost({
      forceDraft: review,
      title: article.title,
      slug: article.slug,
      contentHtml: body,
      categoryIds: [store.wpCategoryId, MBPIT_PARENT_CATEGORY_ID],
      // 施工区分のタグ（ポータルのジャンル絞り込みが参照する）
      tagIds: tagIdsForCategory(opts.category),
      featuredMediaId: medias[0]?.id,
      metaDescription: article.meta_description,
      focusKeyword: article.focus_keyword,
    });

    /*
     * 本文（bodyHtml）は確認画面で読めるように保存する。
     * 以前は本文をどこにも保存しておらず、生成→即公開の間に人が見る手段が無かった。
     */
    await prisma.pitPost.update({
      where: { id: post.id },
      data: {
        status: review ? "review" : "published",
        title: article.title,
        wpPostId: wpPost.id,
        publishedUrl: wpPost.link,
        bodyHtml: body,
      },
    });

    if (review) {
      await notify({
        type: "PIT_PUBLISHED",
        title: "施工記録の記事ができました（公開前の確認待ち）",
        message: `${store.displayName}: ${article.title}`,
        dealerId: null,
        link: "/dealer/pit",
      });
      return { status: "review", postId: post.id, title: article.title };
    }

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
