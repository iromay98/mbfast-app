/*
 * 施工記録の公開に合わせて、その店のGoogleビジネスプロフィールにも投稿する。
 *
 * 設計上の前提（安全側に倒している理由）:
 *
 * - GBPの投稿は**作成後に編集できない**。直すには消して作り直すしかないので、
 *   誤った内容を出すと取り返しがつかない。したがって
 *     ・紐付け済み かつ 投稿が明示的に有効化されている店だけ
 *     ・本部確認待ち(review)の記事は送らない（公開済みだけ）
 *   の二重条件を満たしたときのみ送る。
 *
 * - 投稿の失敗で施工記録の公開自体を失敗させない。ブログ公開は成立させ、
 *   GBP側は結果を記録して本部に知らせる（後から手当てできる）。
 *
 * - 1日の作成上限（このプロジェクトは100件/日・2026-08実測）を超えると
 *   RESOURCE_EXHAUSTED が返る。これは異常ではないので、エラーとして
 *   騒がずに「上限」として記録し、本部に伝える。
 */

import { prisma } from "@/lib/db";
import { createLocalPost, GbpError, type LocalPostDraft } from "@/server/pit/gbp/client";
import { accessTokenFor } from "@/server/pit/gbp/self-auth";
import { decryptToken } from "@/server/pit/gbp/token-crypto";
import { notify } from "@/server/notifications";
import { buildMapPostText } from "@/lib/pit/map-post-text";

export { buildMapPostText };

type Target = {
  accountId: string;
  locationId: string;
  /** 方式Bの店はその店のトークンで投稿する。方式Aなら undefined（本部のトークン） */
  token?: string;
};

/** その店に投稿できるか判定し、使うトークンを決める */
async function resolveTarget(storeId: string): Promise<{ target?: Target; skip?: string }> {
  const s = await prisma.pitStore.findUnique({
    where: { id: storeId },
    select: {
      gbpAccountId: true,
      gbpLocationId: true,
      gbpPostingEnabled: true,
      gbpAuthMode: true,
      gbpRefreshTokenEnc: true,
    },
  });
  if (!s) return { skip: "店舗が見つかりません" };
  if (!s.gbpPostingEnabled) return { skip: "投稿が有効化されていません" };
  if (!s.gbpLocationId || !s.gbpAccountId) return { skip: "Googleマップと紐付いていません" };

  if (s.gbpAuthMode === "SELF") {
    const refresh = decryptToken(s.gbpRefreshTokenEnc);
    if (!refresh) return { skip: "連携情報を読み取れません（再連携が必要）" };
    try {
      const token = await accessTokenFor(refresh);
      return { target: { accountId: s.gbpAccountId, locationId: s.gbpLocationId, token } };
    } catch (e) {
      // 店側が連携を解除した／失効。以後の投稿を止めて再連携を促す
      if (e instanceof GbpError && e.kind === "auth") {
        await prisma.pitStore.update({
          where: { id: storeId },
          data: { gbpAuthRevokedAt: new Date(), gbpPostingEnabled: false },
        });
        return { skip: "Googleとの連携が切れています（再連携が必要）" };
      }
      throw e;
    }
  }
  return { target: { accountId: s.gbpAccountId, locationId: s.gbpLocationId } };
}

export type MapPostOutcome =
  | { state: "posted"; name: string }
  | { state: "skipped"; reason: string }
  | { state: "quota" }
  | { state: "failed"; error: string };

/**
 * 公開済みの施工記録をGoogleマップへ投稿する。
 * **例外は投げない**（呼び出し元のブログ公開を巻き込まないため）。
 */
export async function postRecordToMap(opts: {
  storeId: string;
  storeName: string;
  postId: string;
  vehicle: string;
  title: string;
  memo?: string | null;
  articleUrl: string;
  /**
   * 写真の公開URL（WordPressにアップ済みのもの）。
   * GBPは**Google側がこのURLを取りに来る**ので、外から見えるURLでなければならない。
   * アプリのstorageは非公開なのでそちらは使えない。
   */
  photoUrl?: string | null;
}): Promise<MapPostOutcome> {
  try {
    const { target, skip } = await resolveTarget(opts.storeId);
    if (!target) return { state: "skipped", reason: skip ?? "対象外" };

    const draft: LocalPostDraft = {
      summary: buildMapPostText({ vehicle: opts.vehicle, title: opts.title, memo: opts.memo }),
      cta: { type: "LEARN_MORE", url: opts.articleUrl },
    };
    // 写真はGoogle側が取りに来るので、httpsの公開URLのときだけ付ける。
    // 取得できないURLを渡すと投稿そのものが失敗する（＝文章まで出せなくなる）
    if (opts.photoUrl && /^https:\/\//.test(opts.photoUrl)) draft.photoUrl = opts.photoUrl;

    /*
     * 写真付きで失敗したら、写真なしで1回だけ再試行する。
     *
     * GBPの写真は「GoogleがsourceUrlを取りに来る」方式で、取得に失敗すると
     * 投稿全体が "Internal error encountered."（500）で落ちる。
     * mbfasttuning.com はWAFがブラウザ系UAを弾くため、Googleの取得が
     * 失敗する可能性がある（2026-08-27 マセラティ投稿で実際に発生）。
     * 写真のために文章まで道連れにしない＝テキストだけでも出す方が価値がある。
     */
    let post;
    try {
      post = await createLocalPost(target.accountId, target.locationId, draft, target.token);
    } catch (e) {
      const retryable = e instanceof GbpError && e.kind !== "quota" && e.kind !== "auth";
      if (!draft.photoUrl || !retryable) throw e;
      const { photoUrl: _dropped, ...textOnly } = draft;
      post = await createLocalPost(target.accountId, target.locationId, textOnly, target.token);
      // 写真を落として通った＝写真URLの取得失敗が濃厚。本部が気づけるよう通知する
      await notify({
        type: "PIT_PUBLISHED",
        title: "Googleマップ投稿: 写真なしで投稿しました",
        message: `${opts.storeName}「${opts.title}」は写真付きで失敗したため、文章のみで投稿しました。写真URL(${draft.photoUrl})をGoogleが取得できていない可能性があります（WAFのUA制限を確認）。`,
        dealerId: null,
        link: "/hq/pit/gbp",
      });
    }
    await prisma.pitPost.update({
      where: { id: opts.postId },
      data: { gbpPostName: post.name ?? "", gbpPostedAt: new Date(), gbpError: null },
    });
    return { state: "posted", name: post.name ?? "" };
  } catch (e) {
    const isQuota = e instanceof GbpError && e.kind === "quota";
    const msg = e instanceof Error ? e.message : String(e);
    await prisma.pitPost
      .update({ where: { id: opts.postId }, data: { gbpError: msg.slice(0, 500) } })
      .catch(() => {});

    await notify({
      type: "PIT_PUBLISHED",
      title: isQuota
        ? "Googleマップ投稿: 1日の上限に達しました"
        : "Googleマップへの投稿に失敗しました",
      message: isQuota
        ? `${opts.storeName}「${opts.title}」はGoogleマップに投稿できませんでした（1日の作成上限）。ブログ記事は公開済みです。`
        : `${opts.storeName}「${opts.title}」: ${msg}`,
      dealerId: null,
      link: "/hq/pit/gbp",
    });
    return isQuota ? { state: "quota" } : { state: "failed", error: msg };
  }
}
