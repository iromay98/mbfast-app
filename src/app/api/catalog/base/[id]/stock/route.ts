import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { storage } from "@/server/storage";
import { fileResponse } from "@/server/catalog/download-log";
import { buildDownloadName, extFromName } from "@/server/catalog/filename";

// 本店専用: BaseFile の原本(ストック)ファイルをダウンロード。DEALER は一律 403。
export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (user.role !== "HQ_ADMIN") return new Response("Forbidden", { status: 403 });

  const { id } = await ctx.params;
  const base = await prisma.baseFile.findUnique({
    where: { id },
    select: {
      stockFileRef: true,
      stockFileName: true,
      stockContentType: true,
      model: true,
      generation: true,
      calNumber: true,
      method: true,
    },
  });
  if (!base || !base.stockFileRef) return new Response("Not Found", { status: 404 });

  const file = await storage.read(base.stockFileRef);
  if (!file) return new Response("Not Found", { status: 404 });

  const name = buildDownloadName({
    model: base.model,
    generation: base.generation,
    cal: base.calNumber,
    method: base.method,
    content: "ori",
    ext: extFromName(base.stockFileName, "bin"),
  });
  return fileResponse(file, name, base.stockContentType);
}
