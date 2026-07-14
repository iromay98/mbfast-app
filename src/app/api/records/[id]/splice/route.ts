import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { storage } from "@/server/storage";
import { contentDisposition } from "@/server/catalog/filename";

// ニコイチ候補binのダウンロード（本店のみ・確認用）。
// ?key=records/splice/<recordId>__... のキーを検証して配信。代理店には一切出さない。
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (user.role !== "HQ_ADMIN") return new Response("Forbidden", { status: 403 });

  const { id } = await ctx.params;
  const rec = await prisma.serviceRecord.findUnique({ where: { id }, select: { id: true } });
  if (!rec) return new Response("Not Found", { status: 404 });

  const key = request.nextUrl.searchParams.get("key") ?? "";
  // この記録の splice 候補キーのみ許可（他記録・任意パスの露出防止）
  if (!key.startsWith(`records/splice/${id}__`) || key.includes("..")) {
    return new Response("Bad Request", { status: 400 });
  }
  const file = await storage.read(key);
  if (!file) return new Response("Not Found", { status: 404 });

  const name = `splice_candidate_${id}.bin`;
  return new Response(new Uint8Array(file.buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(file.size),
      "Content-Disposition": contentDisposition(name),
      "Cache-Control": "private, no-store",
    },
  });
}
