import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { storage } from "@/server/storage";
import { PIT_IMAGE_MIME } from "@/server/pit/images";

/*
 * 投稿写真の配信（**本部専用**）。SNS・広告素材の二次利用のため、
 * 投稿に使われた写真（ぼかし済み・1600px WebP＝保存されている実体そのまま）を落とせる。
 *
 * - ?i=<番号> でその1枚。指定なしは JSON で一覧（枚数とURL）を返す
 * - 保存キーは公開ディレクトリに無く、この経路以外から読めない（推測不能キー方式は従来どおり）
 * - 加盟店には見せない（自店の写真は自分の端末と記事にあるので、この経路は本部の集材専用）
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ postId: string }> }) {
  const user = await getSessionUser();
  if (!user || user.role !== "HQ_ADMIN") return new Response("Forbidden", { status: 403 });

  const { postId } = await ctx.params;
  const post = await prisma.pitPost.findUnique({
    where: { id: postId },
    select: {
      photoKeys: true,
      vehicle: true,
      createdAt: true,
      store: { select: { slug: true } },
    },
  });
  if (!post) return new Response("Not Found", { status: 404 });

  const keys = (post.photoKeys as string[] | null) ?? [];
  const iRaw = request.nextUrl.searchParams.get("i");

  if (iRaw === null) {
    // 一覧（管理画面がリンクを並べるための情報だけ。キー自体は返さない）
    return Response.json({
      count: keys.length,
      photos: keys.map((_, i) => ({
        index: i,
        url: `/api/pit/post-photos/${postId}?i=${i}`,
      })),
    });
  }

  const i = Number(iRaw);
  if (!Number.isInteger(i) || i < 0 || i >= keys.length) {
    return new Response("Not Found", { status: 404 });
  }
  const file = await storage.read(keys[i]);
  if (!file) return new Response("Not Found", { status: 404 });

  // DL時のファイル名: 店舗slug＋日付＋連番（保存キーのUUIDのままだと整理できない）
  const day = post.createdAt.toISOString().slice(0, 10);
  const name = `${post.store.slug}-${day}-${i + 1}.webp`;
  return new Response(new Uint8Array(file.buffer), {
    headers: {
      "content-type": PIT_IMAGE_MIME,
      "content-length": String(file.buffer.byteLength),
      "content-disposition": `attachment; filename="${name}"`,
      "cache-control": "private, max-age=300",
    },
  });
}
