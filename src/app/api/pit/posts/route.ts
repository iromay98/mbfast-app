import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { storage } from "@/server/storage";
import { runPitPipeline } from "@/server/pit/pipeline";
import { pitAiEnabled } from "@/server/pit/generate";
import { wpConfigured } from "@/server/pit/wordpress";
import { upsertVehicle, vehicleFeatureEnabled } from "@/server/pit/vehicle";
import { parseVideoUrl } from "@/server/pit/video-embed";
import { notifyBadgeIfReached, storeStats } from "@/server/pit/gamification";
import { consumeStagedDraft } from "@/server/pit/cert-blog-link";
import { GENRE_SLUGS, normalizeGenreSlug } from "@/lib/mbpit-genres";

// mbPIT 施工記録の投稿 → AI記事化 → WordPress自動公開。
// 店舗IDは認証セッションから解決する（クライアントの申告値は信用しない）。
// AI生成＋画像アップロードで数分かかりうるため maxDuration を延長。
export const maxDuration = 300;

// 公式8ジャンル（本部管理・src/config/mbpit-genres.json が単一の正）。
// 旧5区分の値(polish/other)が来た場合は normalizeGenreSlug で現行ジャンルに読み替えて受ける
const CATEGORIES = GENRE_SLUGS;
const MAX_PHOTOS = 10;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 10MB/枚
/*
 * 一括送信で受け付ける動画の上限。
 * これを超えるものはクライアントが分割アップロード(/api/pit/upload)に切り替えるので、
 * ここに大きいファイルが来ることは通常ない（来たらクライアント側の不具合）。
 * 上限を大きくしないのは、一括送信は全部メモリに載るため。
 */
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const MAX_MEMO_LEN = 1000; // 音声書き起こし対応で拡張（30秒×数回分）

const STORE_SELECT = {
  id: true,
  displayName: true,
  slug: true,
  wpCategoryId: true,
  footerHtml: true,
  faqJson: true,
  // 公開前確認（ONなら生成後に review で止める）
  postReviewRequired: true,
  active: true,
} as const;

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return json(401, { error: "ログインしてください" });

  if (!pitAiEnabled()) return json(503, { error: "記事生成AIが未設定です（本部にお問い合わせください）" });
  if (!wpConfigured()) return json(503, { error: "ブログ公開の設定が未完了です（本部にお問い合わせください）" });

  // ── 入力（multipart/form-data） ──
  let form: FormData;
  try {
    form = await request.formData();
  } catch (e) {
    // 大きすぎる添付（動画など）で本体の読み取りに失敗するケースがあるため、原因をログに残す
    console.error("mbPIT: リクエスト本体の解析に失敗", e);
    return json(413, {
      error:
        "送信データが大きすぎて受け取れませんでした。動画を短くする（または外す）か、写真の枚数を減らしてお試しください。",
    });
  }

  // ── 投稿先店舗の解決 ──
  // 代理店: セッションの dealerId から解決（クライアントの申告値は信用しない）。
  // 本部(HQ_ADMIN): フォームの storeId で任意の店舗として投稿できる（本店直営・停止中も可）。
  let storeKey: { id: string } | { dealerId: string };
  if (user.role === "HQ_ADMIN") {
    const storeId = String(form.get("storeId") ?? "").trim();
    if (!storeId) return json(400, { error: "投稿先の店舗を選択してください" });
    storeKey = { id: storeId };
  } else {
    if (!user.dealerId) return json(403, { error: "店舗アカウントでログインしてください" });
    storeKey = { dealerId: user.dealerId };
  }
  const store = await prisma.pitStore.findUnique({ where: storeKey, select: STORE_SELECT });
  if (!store || (user.role !== "HQ_ADMIN" && !store.active)) {
    return json(403, { error: "この店舗はmbPIT投稿の対象になっていません（本部にお問い合わせください）" });
  }
  // 自己登録直後などWPカテゴリ未作成の店舗（承認時に自動作成される）
  if (store.wpCategoryId <= 0) {
    return json(409, { error: "この店舗のWordPressカテゴリが未作成です。管理画面から店舗を承認してください" });
  }

  const vehicle = String(form.get("vehicle") ?? "").trim();
  const category = normalizeGenreSlug(String(form.get("category") ?? "").trim());
  const memoRaw = String(form.get("memo") ?? "").trim();

  // 施工証明から用意したスタンバイ下書きを引き継ぐ場合の元ID（任意）。
  // 妥当性は投稿成功後の consumeStagedDraft 側で store/status を条件に確認する。
  const stagedPostId = String(form.get("stagedPostId") ?? "").trim() || null;

  // ── 品質ゲート ──
  if (!vehicle) return json(400, { error: "車種を入力してください" });
  if (!CATEGORIES.has(category)) return json(400, { error: "施工内容のカテゴリを選択してください" });
  if (memoRaw.length > MAX_MEMO_LEN) return json(400, { error: `メモは${MAX_MEMO_LEN}文字以内にしてください` });

  const files = form.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return json(400, { error: "写真を1枚以上追加してください" });
  if (files.length > MAX_PHOTOS) return json(400, { error: `写真は${MAX_PHOTOS}枚までです` });
  for (const f of files) {
    if (f.size > MAX_PHOTO_BYTES) return json(400, { error: "写真は1枚10MB以下にしてください" });
  }

  const photos = [];
  for (const f of files) {
    photos.push({ buffer: Buffer.from(await f.arrayBuffer()) });
  }

  // 施工日（任意）。まとめて投稿でも実際の作業日を記事に出せる。未来日と2年超の過去は弾く
  let workDate: string | null = null;
  const workDateRaw = String(form.get("workDate") ?? "").trim();
  if (workDateRaw) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(workDateRaw)) {
      return json(400, { error: "施工日の形式が正しくありません" });
    }
    const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
    const twoYearsAgo = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000)
      .toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
    if (workDateRaw > today) return json(400, { error: "施工日に未来の日付は指定できません" });
    if (workDateRaw < twoYearsAgo) return json(400, { error: "施工日が古すぎます（2年以内にしてください）" });
    workDate = workDateRaw;
  }

  // 動画URL（任意・推奨経路）。YouTube等に置いてもらえばサーバー容量を使わない
  let videoUrl: string | null = null;
  const videoUrlRaw = String(form.get("videoUrl") ?? "").trim();
  if (videoUrlRaw) {
    const parsed = parseVideoUrl(videoUrlRaw);
    if (!parsed || parsed.kind === "unsupported") {
      return json(400, { error: parsed?.kind === "unsupported" ? parsed.reason : "動画URLが正しくありません" });
    }
    videoUrl = videoUrlRaw;
  }

  // 動画（任意・1本）。ぼかし加工なし＝映り込みは投稿者確認（フォームに注意書きあり）
  //
  // 大きい動画は分割アップロード済み（/api/pit/upload）でキーだけが渡ってくる。
  // 一括送信だと数百MBがメモリに丸ごと載り、2GB RAMのVPSでは投稿中にアプリごと
  // 落ちうる（落ちれば他の加盟店の操作も巻き添えになる）ため。
  let video: { buffer: Buffer; type: string } | null = null;
  const uploadedKey = String(form.get("uploadedVideoKey") ?? "").trim();
  if (uploadedKey) {
    // キーは必ず自店のprefix配下であること（他店のファイルを掴ませない）
    if (!uploadedKey.startsWith(`pit-videos/${store.id}/`)) {
      return json(403, { error: "動画の参照が不正です" });
    }
    const f = await storage.read(uploadedKey);
    if (!f) return json(400, { error: "アップロードした動画が見つかりません。もう一度お試しください。" });
    if (!f.contentType?.startsWith("video/")) {
      return json(400, { error: "動画ファイルを選択してください" });
    }
    video = { buffer: f.buffer, type: f.contentType };
    // 一時保管を残さない（パイプライン側で本保存されるため）
    await storage.delete(uploadedKey).catch(() => {});
  } else {
    const videoFile = form.get("video");
    if (videoFile instanceof File && videoFile.size > 0) {
      if (!videoFile.type.startsWith("video/")) return json(400, { error: "動画ファイルを選択してください" });
      if (videoFile.size > MAX_VIDEO_BYTES) {
        return json(400, {
          error: "動画の送信に失敗しました。もう一度お試しください（大きい動画は自動で分割送信されます）",
        });
      }
      video = { buffer: Buffer.from(await videoFile.arrayBuffer()), type: videoFile.type };
    }
  }

  // 車検証QR（または手入力の車台番号）が付いていれば車両に紐づけ（お薬手帳）。
  // 失敗しても投稿自体は続行する（車両紐づけは任意機能）。
  let vehicleId: string | null = null;
  const chassisRaw = String(form.get("chassisNo") ?? "").trim();
  if (chassisRaw && vehicleFeatureEnabled()) {
    try {
      const expiryRaw = String(form.get("inspectionExpiry") ?? "").trim();
      const v = await upsertVehicle({
        chassisOrQr: chassisRaw,
        vehicleName: vehicle,
        inspectionExpiry: /^\d{4}-\d{2}-\d{2}$/.test(expiryRaw) ? new Date(`${expiryRaw}T00:00:00+09:00`) : null,
      });
      vehicleId = v?.id ?? null;
    } catch (e) {
      console.error("mbPIT: 車両紐づけに失敗（投稿は続行）", e);
    }
  }

  const result = await runPitPipeline({
    store,
    vehicle,
    category,
    memo: memoRaw || null,
    photos,
    video,
    videoUrl,
    workDate,
    vehicleId,
  });

  // 施工証明のスタンバイ下書きから来た投稿なら、証明書の紐付けを本物の記事へ張り替え、
  // 空のプレースホルダを片付ける（失敗しても投稿の成功は返す）。
  if (stagedPostId && result.status !== "failed") {
    try {
      await consumeStagedDraft(store.id, stagedPostId, result.postId);
    } catch (e) {
      console.error("mbPIT: スタンバイ下書きの引き継ぎに失敗（投稿は成功）", e);
    }
  }

  switch (result.status) {
    case "published": {
      // ゲーミフィケーション: 最新の通算/今月/ストリーク/バッジを返し、称号到達なら本部へ通知
      let stats = null;
      try {
        stats = await storeStats(store.id);
        await notifyBadgeIfReached(store.id, store.displayName, stats.total);
      } catch (e) {
        console.error("mbPIT: 統計計算に失敗", e);
      }
      return json(200, {
        status: "published",
        url: result.url,
        title: result.title,
        stats,
        vehicleLinked: !!vehicleId,
      });
    }
    case "review":
      /*
       * 公開前確認がONの店舗。記事は作成済みで、承認されると公開される。
       * このcaseが無かった時期は応答が壊れ、成功なのに「送信に失敗」と出て
       * 加盟店が連打→同じ記事のreviewが量産されていた（実害あり）。
       */
      return json(200, {
        status: "review",
        postId: result.postId, // 完了画面から確認プレビューへ直行するためのリンク先
        title: result.title,
        message: "記事を作成しました。内容を確認して「公開する」を押すと公開されます。",
      });
    case "held":
      // 理由の詳細（規制関連ワード）は店舗にそのまま返さず、確認中である旨のみ伝える
      return json(200, {
        status: "held",
        message: "この内容は自動公開の対象外のため、本部確認となりました。確認後にご連絡します。",
      });
    case "failed":
      return json(500, { status: "failed", error: "記事の作成に失敗しました。時間をおいて再度お試しください。" });
  }
}

function json(status: number, body: unknown): Response {
  return Response.json(body, { status });
}
