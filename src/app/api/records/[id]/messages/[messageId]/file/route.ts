import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { storage } from "@/server/storage";
import { fileResponse } from "@/server/catalog/download-log";

// 案件メッセージの添付ファイルDL。本店は全件、代理店は自店の記録のみ。
export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string; messageId: string }> },
) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id: recordId, messageId } = await ctx.params;
  const rec = await prisma.serviceRecord.findUnique({
    where: { id: recordId },
    select: { dealerId: true },
  });
  if (!rec) return new Response("Not Found", { status: 404 });
  if (user.role === "DEALER" && user.dealerId !== rec.dealerId) {
    return new Response("Forbidden", { status: 403 });
  }

  const msg = await prisma.recordMessage.findUnique({
    where: { id: messageId },
    select: { serviceRecordId: true, filePath: true, fileName: true, contentType: true },
  });
  if (!msg || msg.serviceRecordId !== recordId || !msg.filePath) {
    return new Response("Not Found", { status: 404 });
  }
  const f = await storage.read(msg.filePath);
  if (!f) return new Response("Not Found", { status: 404 });

  return fileResponse(
    { buffer: f.buffer, contentType: msg.contentType ?? "application/octet-stream", size: f.size },
    msg.fileName ?? "file",
    msg.contentType,
  );
}
