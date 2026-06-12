import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { storage } from "@/server/storage";

// 施工写真の認可付き配信。推測可能URLでの直接配信はせず、
// 必ず親レコード(ServiceRecord)のアクセス権を確認してから返す。
export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string; index: string }> },
) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id, index } = await ctx.params;
  const record = await prisma.serviceRecord.findUnique({
    where: { id },
    select: { dealerId: true, photoPaths: true },
  });
  if (!record) return new Response("Not Found", { status: 404 });

  // 代理店は自店の記録のみ。本店は全件可。
  if (user.role === "DEALER" && user.dealerId !== record.dealerId) {
    return new Response("Forbidden", { status: 403 });
  }

  const i = Number(index);
  const key = record.photoPaths[i];
  if (!key) return new Response("Not Found", { status: 404 });

  const file = await storage.read(key);
  if (!file) return new Response("Not Found", { status: 404 });

  return new Response(new Uint8Array(file.buffer), {
    status: 200,
    headers: {
      "Content-Type": file.contentType,
      "Content-Length": String(file.size),
      // 機微情報のため共有キャッシュ禁止（ブラウザの private キャッシュのみ）
      "Cache-Control": "private, max-age=60",
    },
  });
}
