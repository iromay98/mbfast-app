import { readCertificateMediaFile } from "@/server/pit/cert-media";

/*
 * 共有ページ（ログイン不要）の写真配信。
 * 共有トークンを知っている人にだけ、**公開可の写真だけ**を返す。
 *  - 発行済み・共有停止でない証明書に限る
 *  - 種別が許可リストにあるものだけ（DBのフラグが誤っていても種別で弾く）
 * 証明書IDをURLに出さない（トークン配下に置く）。
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ token: string; mediaId: string }> },
) {
  const { token, mediaId } = await ctx.params;
  const file = await readCertificateMediaFile(mediaId, { scope: "public", shareToken: token });
  if (!file) return new Response("Not Found", { status: 404 });

  return new Response(new Uint8Array(file.buffer), {
    headers: {
      "content-type": file.contentType,
      "content-length": String(file.buffer.byteLength),
      "cache-control": "private, max-age=600",
      // 検索エンジンに拾わせない（共有ページ本体と同じ扱い）
      "x-robots-tag": "noindex, nofollow",
    },
  });
}
