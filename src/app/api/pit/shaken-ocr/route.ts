import type { NextRequest } from "next/server";
import sharp from "sharp";
import { getSessionUser } from "@/lib/authz";
import { readShakenImage, shakenOcrEnabled } from "@/server/pit/shaken-ocr";

/*
 * 車検証の読み取り。返すのは「フォームに入れる候補値」だけで、DBには何も保存しない。
 *
 *  - 画像はメモリ上でのみ扱い、保存しない（氏名・住所・車台番号が写っているため）
 *  - 読み取った値はログに出さない
 *  - 認証必須。読み取り結果は呼び出した本人にだけ返す
 *  - 失敗しても手入力で進められるので、エラーは短く返す
 */
export const maxDuration = 60;

const MAX_BYTES = 15 * 1024 * 1024;
// Claudeへ渡す前に長辺2200pxへ縮める（小さすぎると細字が読めず、大きすぎると転送が重い）
const MAX_EDGE = 2200;

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return json(401, { error: "ログインしてください" });
  if (!shakenOcrEnabled()) return json(503, { error: "読み取り機能が未設定です（本部にお問い合わせください）" });

  let form: FormData;
  try {
    form = await request.formData();
  } catch (e) {
    console.error("mbPIT: 車検証画像の受信に失敗", e instanceof Error ? e.message : "unknown");
    return json(413, { error: "画像を受け取れませんでした。もう一度お試しください" });
  }

  const file = form.get("file");
  if (!(file instanceof File)) return json(400, { error: "車検証の写真を選択してください" });
  if (file.size > MAX_BYTES) return json(413, { error: "画像が大きすぎます（15MBまで）" });

  let jpeg: Buffer;
  try {
    // HEIC等も含めJPEGへ正規化し、EXIFの回転を適用（位置情報などのメタデータは落ちる）
    jpeg = await sharp(Buffer.from(await file.arrayBuffer()), { failOn: "none" })
      .rotate()
      .resize(MAX_EDGE, MAX_EDGE, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 88 })
      .toBuffer();
  } catch {
    return json(400, { error: "画像を読み込めませんでした。別の写真でお試しください" });
  }

  const { result, error } = await readShakenImage(jpeg, "image/jpeg");
  if (!result) return json(422, { error: error ?? "読み取れませんでした" });
  return json(200, result);
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
