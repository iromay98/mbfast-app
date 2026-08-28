import sharp from "sharp";
import { verifyPhotoToken } from "@/server/pit/photo-public";
import { storage } from "@/server/storage";

/*
 * Googleマップ投稿用・写真の公開配信（認証なし）。
 *
 * 認証なしで良い理由: 配信できるのはHMAC署名付きトークンが指す pit/ 配下の
 * 1枚だけで、そのトークンは「Googleマップに公開する投稿」のためにこちらが
 * 生成したもの。つまりここから見える写真は、既に公衆へ出すと決めた写真に限る。
 * ストレージの他領域（車検証・案件ファイル等）はトークンを偽造できない限り
 * 到達不能（photo-public.ts の検証で pit/ 以外は拒否）。
 *
 * キャッシュを長めに許すのは、Googleが投稿カード表示のたびに再取得しても
 * こちらの負荷にならないようにするため（写真は immutable なキー運用）。
 */
export async function GET(_req: Request, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const key = verifyPhotoToken(token);
  if (!key) return new Response("Not Found", { status: 404 });

  const f = await storage.read(key);
  if (!f) return new Response("Not Found", { status: 404 });

  /*
   * JPEGに変換して返す。
   * 保存形式はWebPだが、GBPの投稿写真はJPEG/PNG前提でWebPを拒否する
   * （URL自体は200で取得できるのに投稿がINTERNALで落ちる＝2026-08-28実測）。
   * 変換は取得のたびに行うが、Googleの取得は投稿時と稀な再取得だけなので
   * 負荷は問題にならない。EXIFはsharpが出力時に落とす（位置情報を漏らさない）。
   */
  const jpeg = await sharp(f.buffer).jpeg({ quality: 88 }).toBuffer();
  return new Response(new Uint8Array(jpeg), {
    headers: {
      "content-type": "image/jpeg",
      "content-length": String(jpeg.byteLength),
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
