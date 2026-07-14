import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { storage } from "@/server/storage";
import { contentDisposition } from "@/server/catalog/filename";

// 本店専用ファイルのダウンロード。代理店には一切公開しない（403）。
export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string; fileId: string }> },
) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (user.role !== "HQ_ADMIN") return new Response("Forbidden", { status: 403 });

  const { id, fileId } = await ctx.params;
  const f = await prisma.recordHqFile.findUnique({
    where: { id: fileId },
    select: { serviceRecordId: true, filePath: true, fileName: true, contentType: true },
  });
  // 記録との紐付きも確認（IDの取り違え・列挙防止）
  if (!f || f.serviceRecordId !== id) return new Response("Not Found", { status: 404 });

  const file = await storage.read(f.filePath);
  if (!file) return new Response("Not Found", { status: 404 });

  return new Response(new Uint8Array(file.buffer), {
    status: 200,
    headers: {
      "Content-Type": f.contentType ?? "application/octet-stream",
      "Content-Length": String(file.size),
      "Content-Disposition": contentDisposition(f.fileName),
      "Cache-Control": "private, no-store",
    },
  });
}
