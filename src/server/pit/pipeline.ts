import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { storage } from "@/server/storage";
import { notify } from "@/server/notifications";
import { runContentGuard, CAUTION_NOTICE_HTML } from "@/server/pit/guard";
import { processPhoto, type PlateBlurLogEntry } from "@/server/pit/image";
import { generateArticle, sanitizeSlug } from "@/server/pit/article";
import {
  wpConfigured,
  uploadMedia,
  publishPost,
  genreCategoryId,
  PIT_PARENT_CATEGORY_ID,
  type WpMedia,
} from "@/server/pit/wordpress";

/*
 * mbPIT 記事化パイプライン本体。
 * 投稿受付(API)後に after() でバックグラウンド実行される。
 * 順序: ガード → 画像処理(ぼかし+リサイズ) → AI記事生成 → WordPress公開 → 通知。
 * 途中失敗は PitPost.status=FAILED + error に保存（HQ から再試行可能）。
 */

// 記事slug末尾の日付（JST）。将来のドメイン移行時に slug ベースでリダイレクト表を
// 機械生成するため、店舗slug＋日付を必ず含める形式にする。
function yyyymmddJst(d: Date): string {
  const parts = new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}${get("month")}${get("day")}`;
}

// Gutenberg 画像ブロック
function imageBlock(media: WpMedia, alt: string): string {
  const esc = alt.replace(/"/g, "&quot;");
  return [
    `<!-- wp:image {"id":${media.id},"sizeSlug":"large","linkDestination":"none"} -->`,
    `<figure class="wp-block-image size-large"><img src="${media.sourceUrl}" alt="${esc}" class="wp-image-${media.id}"/></figure>`,
    `<!-- /wp:image -->`,
  ].join("\n");
}

// AI が [image:n] を段落ブロックで包んでいても、裸で置いていても差し替えられるようにする
const PLACEHOLDER_RE =
  /(?:<!--\s*wp:paragraph\s*-->\s*<p>\s*)?\[image:(\d+)\](?:\s*<\/p>\s*<!--\s*\/wp:paragraph\s*-->)?/g;

export function assembleBody(opts: {
  bodyHtml: string;
  media: WpMedia[];
  alts: string[];
  cautionNotice: boolean;
  footerHtml: string;
}): string {
  const used = new Set<number>();
  let body = opts.bodyHtml.replace(PLACEHOLDER_RE, (_m, nStr: string) => {
    const idx = parseInt(nStr, 10) - 1;
    const media = opts.media[idx];
    if (!media || used.has(idx)) return ""; // 範囲外・重複プレースホルダは除去
    used.add(idx);
    return imageBlock(media, opts.alts[idx] ?? "");
  });

  // プレースホルダに使われなかった写真は本文末尾へ（写真は必ず全掲載する）
  const leftovers = opts.media
    .map((m, i) => ({ m, i }))
    .filter(({ i }) => !used.has(i))
    .map(({ m, i }) => imageBlock(m, opts.alts[i] ?? ""));
  if (leftovers.length > 0) body += `\n${leftovers.join("\n")}`;

  if (opts.cautionNotice) body += `\n${CAUTION_NOTICE_HTML}`;

  // 店舗紹介＋CTAフッター（DBの定型HTML）。Gutenberg 上は html ブロックとして結合。
  if (opts.footerHtml.trim()) {
    body += `\n<!-- wp:html -->\n${opts.footerHtml.trim()}\n<!-- /wp:html -->`;
  }
  return body;
}

export async function runPitPipeline(
  postId: string,
  opts: { skipBlockGuard?: boolean } = {},
): Promise<void> {
  const post = await prisma.pitPost.findUnique({
    where: { id: postId },
    include: { store: true },
  });
  if (!post) return;
  const store = post.store;

  const fail = async (message: string) => {
    console.error(`mbPIT: post=${postId} 失敗: ${message}`);
    await prisma.pitPost.update({
      where: { id: postId },
      data: { status: "FAILED", error: message.slice(0, 1000) },
    });
    await notify({
      type: "PIT_FAILED",
      title: "mbPIT 記事の自動公開に失敗",
      message: `${store.displayName} / ${post.vehicle}: ${message.slice(0, 200)}`,
      dealerId: null,
      link: "/hq/pit",
    });
  };

  try {
    // ── 1. コンテンツガード ──────────────────────
    const guard = runContentGuard(post.vehicle, post.memo);
    const guardResult = {
      blocked: guard.blocked,
      caution: guard.caution,
      piiRemoved: guard.piiRemoved,
    } satisfies Prisma.InputJsonValue;

    if (guard.blocked.length > 0 && !opts.skipBlockGuard) {
      // 排ガス規制デバイス無効化に該当 → 自動公開せず保留・本部通知のみ
      await prisma.pitPost.update({
        where: { id: postId },
        data: {
          status: "HELD",
          guardResult,
          holdReason: `公開ブロック該当: ${guard.blocked.join(" / ")}`,
        },
      });
      await notify({
        type: "PIT_HELD",
        title: "mbPIT 投稿を保留しました（要確認）",
        message: `${store.displayName} / ${post.vehicle}: ${guard.blocked.join(" / ")} に該当`,
        dealerId: null,
        link: "/hq/pit",
      });
      return;
    }

    // ── 2. 画像処理（ナンバーぼかし＋リサイズ） ──
    const processedPaths: string[] = [];
    const blurLog: PlateBlurLogEntry[] = [];
    const processedBuffers: Buffer[] = [];
    for (let i = 0; i < post.photoPaths.length; i++) {
      const src = await storage.read(post.photoPaths[i]);
      if (!src) throw new Error(`写真ファイルが見つかりません (${i + 1}枚目)`);
      let result;
      try {
        result = await processPhoto(src.buffer, i);
      } catch (e) {
        throw new Error(
          `写真の変換に失敗しました (${i + 1}枚目)。HEIC形式の場合はJPEGで再投稿してください: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
      const key = `pit/processed/${postId}/${i + 1}.jpg`;
      await storage.save(key, result.image.buffer, "image/jpeg");
      processedPaths.push(key);
      processedBuffers.push(result.image.buffer);
      blurLog.push(result.log);
      if (!result.log.detected) {
        // 過検出より未検出を許容するが、必ずログに残す（本部が後追い確認できるように）
        console.warn(
          `mbPIT: post=${postId} photo=${i + 1} ナンバープレート未検出のため素通し` +
            (result.log.error ? ` (${result.log.error})` : ""),
        );
      }
    }
    await prisma.pitPost.update({
      where: { id: postId },
      data: {
        guardResult,
        processedPaths,
        plateBlurLog: blurLog as unknown as Prisma.InputJsonValue,
        cautionAdded: guard.caution.length > 0,
      },
    });

    // ── 3. AI記事生成 ────────────────────────────
    const article = await generateArticle({
      vehicle: post.vehicle,
      category: post.category,
      memo: guard.sanitizedMemo,
      storeName: store.displayName,
      photoCount: processedBuffers.length,
      footerHtml: store.footerHtml,
    });

    // ── 4. WordPress 公開 ────────────────────────
    if (!wpConfigured()) {
      throw new Error("WordPress 認証情報 (WP_USER / WP_APP_PASSWORD) が未設定です");
    }

    const media: WpMedia[] = [];
    for (let i = 0; i < processedBuffers.length; i++) {
      media.push(
        await uploadMedia(processedBuffers[i], article.imageFilenames[i], article.imageAlts[i]),
      );
    }

    const contentHtml = assembleBody({
      bodyHtml: article.bodyHtml,
      media,
      alts: article.imageAlts,
      cautionNotice: guard.caution.length > 0,
      footerHtml: store.footerHtml,
    });

    // slug: {車種ローマ字}-{施工slug}-{店舗slug}-{yyyymmdd}（店舗slugを必ず末尾側に含める）
    const storeSlug = sanitizeSlug(store.storeSlug, "store");
    const base = article.slugBase.includes(storeSlug)
      ? article.slugBase
      : `${article.slugBase}-${storeSlug}`;
    const slug = `${base}-${yyyymmddJst(post.createdAt)}`;

    const categoryIds = [PIT_PARENT_CATEGORY_ID, store.wpCategoryId];
    const genre = genreCategoryId(post.category);
    if (genre && !categoryIds.includes(genre)) categoryIds.push(genre);

    const published = await publishPost({
      title: article.title,
      slug,
      contentHtml,
      categoryIds,
      featuredMediaId: media[0]?.id,
      metaDescription: article.metaDescription,
      focusKeyword: article.focusKeyword,
    });

    // ── 5. 完了保存＋通知 ────────────────────────
    await prisma.pitPost.update({
      where: { id: postId },
      data: {
        status: "PUBLISHED",
        title: article.title,
        slug,
        wpPostId: published.id,
        publishedUrl: published.url,
        publishedAt: new Date(),
        error: null,
        holdReason: null,
      },
    });
    await notify({
      type: "PIT_PUBLISHED",
      title: "施工ブログを公開しました",
      message: `${post.vehicle} の記事を公開しました`,
      dealerId: post.dealerId,
      link: published.url,
    });
  } catch (e) {
    await fail(e instanceof Error ? e.message : String(e));
  }
}
