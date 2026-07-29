import type { NextRequest } from "next/server";
import sharp from "sharp";
import { getSessionUser } from "@/lib/authz";
import { OCR_TARGETS, photoOcrEnabled, readPhotoValues, type OcrTarget } from "@/server/pit/photo-ocr";

/*
 * 施工写真からの値の読み取り（証明書の入力補助）。
 * 返すのはフォームに入れる候補値だけで、写真もDBには保存しない。
 * 認証必須。失敗しても手入力で進められるのでエラーは短く返す。
 */
export const maxDuration = 60;

const MAX_BYTES = 15 * 1024 * 1024;
// 刻印や小さな文字を読むため車検証より高い解像度で渡す
const MAX_EDGE = 2400;

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return json(401, { error: "ログインしてください" });
  if (!photoOcrEnabled()) return json(503, { error: "読み取り機能が未設定です（本部にお問い合わせください）" });

  let form: FormData;
  try {
    form = await request.formData();
  } catch (e) {
    console.error("mbPIT: 写真の受信に失敗", e instanceof Error ? e.message : "unknown");
    return json(413, { error: "画像を受け取れませんでした。もう一度お試しください" });
  }

  const target = String(form.get("target") ?? "");
  if (!OCR_TARGETS.some((t) => t.key === target)) return json(400, { error: "読み取り対象が不正です" });
  const file = form.get("file");
  if (!(file instanceof File)) return json(400, { error: "写真を選択してください" });
  if (file.size > MAX_BYTES) return json(413, { error: "画像が大きすぎます（15MBまで）" });

  let jpeg: Buffer;
  try {
    jpeg = await sharp(Buffer.from(await file.arrayBuffer()), { failOn: "none" })
      .rotate()
      .resize(MAX_EDGE, MAX_EDGE, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 90 })
      .toBuffer();
  } catch {
    return json(400, { error: "画像を読み込めませんでした。別の写真でお試しください" });
  }

  const { result, error } = await readPhotoValues(target as OcrTarget, jpeg, "image/jpeg");
  if (!result) return json(422, { error: error ?? "読み取れませんでした" });
  return json(200, result);
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
