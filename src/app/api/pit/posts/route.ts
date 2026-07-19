import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { runPitPipeline } from "@/server/pit/pipeline";
import { pitAiEnabled } from "@/server/pit/generate";
import { wpConfigured } from "@/server/pit/wordpress";

// mbPIT 施工記録の投稿 → AI記事化 → WordPress自動公開。
// 店舗IDは認証セッションから解決する（クライアントの申告値は信用しない）。
// AI生成＋画像アップロードで数分かかりうるため maxDuration を延長。
export const maxDuration = 300;

const CATEGORIES = new Set(["ecu", "coating", "polish", "maintenance", "other"]);
const MAX_PHOTOS = 10;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 10MB/枚
const MAX_MEMO_LEN = 500;

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return json(401, { error: "ログインしてください" });
  if (!user.dealerId) return json(403, { error: "店舗アカウントでログインしてください" });

  // 店舗マスタ（PitStore）に登録済みの代理店のみ投稿できる
  const store = await prisma.pitStore.findUnique({
    where: { dealerId: user.dealerId },
    select: {
      id: true,
      displayName: true,
      slug: true,
      wpCategoryId: true,
      footerHtml: true,
      faqJson: true,
      active: true,
    },
  });
  if (!store || !store.active) {
    return json(403, { error: "この店舗はmbPIT投稿の対象になっていません（本部にお問い合わせください）" });
  }

  if (!pitAiEnabled()) return json(503, { error: "記事生成AIが未設定です（本部にお問い合わせください）" });
  if (!wpConfigured()) return json(503, { error: "ブログ公開の設定が未完了です（本部にお問い合わせください）" });

  // ── 入力（multipart/form-data） ──
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json(400, { error: "multipart/form-data で送信してください" });
  }

  const vehicle = String(form.get("vehicle") ?? "").trim();
  const category = String(form.get("category") ?? "").trim();
  const memoRaw = String(form.get("memo") ?? "").trim();

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

  const result = await runPitPipeline({
    store,
    vehicle,
    category,
    memo: memoRaw || null,
    photos,
  });

  switch (result.status) {
    case "published":
      return json(200, { status: "published", url: result.url, title: result.title });
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
