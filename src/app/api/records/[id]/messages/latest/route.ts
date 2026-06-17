import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/authz";
import { prisma } from "@/lib/db";

// この案件の最新メッセージ（最小情報）。フォアグラウンド通知のポーリング用。
// 親(ServiceRecord)のアクセス権を確認。本文や添付は返さない（一覧/詳細で取得）。
export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id } = await ctx.params;
  const rec = await prisma.serviceRecord.findUnique({
    where: { id },
    select: { dealerId: true },
  });
  if (!rec) return new Response("Not Found", { status: 404 });
  if (user.role === "DEALER" && user.dealerId !== rec.dealerId) {
    return new Response("Forbidden", { status: 403 });
  }

  const last = await prisma.recordMessage.findFirst({
    where: { serviceRecordId: id },
    orderBy: { createdAt: "desc" },
    select: { id: true, authorRole: true, createdAt: true },
  });

  return Response.json(
    {
      id: last?.id ?? null,
      authorRole: last?.authorRole ?? null,
      createdAt: last?.createdAt ?? null,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
