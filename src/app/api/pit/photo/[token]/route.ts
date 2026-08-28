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

  const f = await storage.stream(key);
  if (!f) return new Response("Not Found", { status: 404 });

  return new Response(f.stream, {
    headers: {
      "content-type": f.contentType || "image/webp",
      "content-length": String(f.size),
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
