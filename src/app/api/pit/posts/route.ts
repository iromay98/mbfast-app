import { after } from "next/server";
import { getSessionUser, isSessionLive } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { saveUpload } from "@/server/storage";
import { runPitPipeline } from "@/server/pit/pipeline";
import { PIT_CATEGORY_CODES, PIT_CATEGORIES, type PitCategoryKey } from "@/lib/pit-labels";

/*
 * POST /api/pit/posts — mbPIT 施工記録の投稿受付。
 * multipart/form-data:
 *   photos[] (または photos): 画像 1〜10枚, 各10MB以下, jpeg/png/heic/webp
 *   vehicle : 車種（必須）
 *   category: ecu | coating | polish | maintenance | other（必須）
 *   memo    : 任意, 500文字以内
 *
 * 店舗IDは認証セッションから取得する（クライアントの申告値は信用しない）。
 * 受付後は PitPost(PROCESSING) を返し、記事化〜WordPress公開は after() で
 * バックグラウンド実行。クライアントは GET /api/pit/posts/{id} でポーリングする。
 */

const MAX_PHOTOS = 10;
const MAX_PHOTO_BYTES = 10 * 1024 * 1024; // 10MB
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/heic",
  "image/heif",
  "image/webp",
]);

function bad(message: string, status = 400): Response {
  return Response.json({ error: message }, { status });
}

export async function POST(req: Request): Promise<Response> {
  // 認可はサーバー側で強制（店舗＝DEALER アカウントのみ）
  const user = await getSessionUser();
  if (!user || !(await isSessionLive(user))) return bad("ログインしてください", 401);
  if (user.role !== "DEALER" || !user.dealerId) return bad("店舗アカウントでログインしてください", 403);

  const store = await prisma.pitStore.findUnique({ where: { dealerId: user.dealerId } });
  if (!store || !store.active) {
    return bad("この店舗では施工ブログ投稿が有効になっていません。本部にお問い合わせください", 403);
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return bad("送信データの形式が正しくありません");
  }

  // ── 品質ゲート（公開前バリデーション） ──────────
  const photos = [...form.getAll("photos"), ...form.getAll("photos[]")].filter(
    (f): f is File => f instanceof File && f.size > 0,
  );
  if (photos.length === 0) return bad("写真を1枚以上追加してください");
  if (photos.length > MAX_PHOTOS) return bad(`写真は${MAX_PHOTOS}枚までにしてください`);
  for (const p of photos) {
    if (p.size > MAX_PHOTO_BYTES) return bad("10MBを超える写真があります。サイズを小さくしてください");
    if (p.type && !ALLOWED_TYPES.has(p.type)) {
      return bad("写真はJPEG・PNG・HEIC形式でアップロードしてください");
    }
  }

  const vehicle = String(form.get("vehicle") ?? "").trim();
  if (!vehicle) return bad("車種を入力してください");
  if (vehicle.length > 100) return bad("車種は100文字以内で入力してください");

  const categoryRaw = String(form.get("category") ?? "").trim();
  const category: PitCategoryKey | undefined =
    PIT_CATEGORY_CODES[categoryRaw.toLowerCase()] ??
    (PIT_CATEGORIES as readonly string[]).find((c) => c === categoryRaw.toUpperCase()) as
      | PitCategoryKey
      | undefined;
  if (!category) return bad("施工内容のカテゴリを選択してください");

  const memo = String(form.get("memo") ?? "").trim();
  if (memo.length > 500) return bad("メモは500文字以内で入力してください");

  // ── 元写真を保存 ────────────────────────────────
  const photoPaths: string[] = [];
  for (const photo of photos) {
    const saved = await saveUpload(photo, "pit/original");
    if (!saved.ok) return bad(saved.error);
    photoPaths.push(saved.key);
  }

  const post = await prisma.pitPost.create({
    data: {
      storeId: store.id,
      dealerId: user.dealerId,
      vehicle,
      category,
      memo: memo || null,
      photoPaths,
      createdById: user.id,
    },
  });

  // 記事化〜公開はレスポンス返却後にバックグラウンド実行
  after(() => runPitPipeline(post.id));

  return Response.json({ id: post.id, status: "PROCESSING" }, { status: 202 });
}
