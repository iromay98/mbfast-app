import { cookies } from "next/headers";
import { prisma } from "@/lib/db";
import { storage } from "@/server/storage";

// マイカーページ用の写真配信。cookieの vehicleKey がその記録の車両と一致する場合のみ返す。
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ postId: string; idx: string }> },
) {
  const { postId, idx } = await params;
  const key = (await cookies()).get("mycar_key")?.value;
  if (!key) return new Response("forbidden", { status: 403 });

  const post = await prisma.pitPost.findUnique({
    where: { id: postId },
    select: { photoKeys: true, vehicleRef: { select: { vehicleKey: true } } },
  });
  if (!post?.vehicleRef || post.vehicleRef.vehicleKey !== key) {
    return new Response("forbidden", { status: 403 });
  }
  const keys = Array.isArray(post.photoKeys) ? (post.photoKeys as string[]) : [];
  const i = Number(idx);
  if (!Number.isInteger(i) || i < 0 || i >= keys.length) {
    return new Response("not found", { status: 404 });
  }
  const file = await storage.read(keys[i]);
  if (!file) return new Response("not found", { status: 404 });
  return new Response(new Uint8Array(file.buffer), {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
