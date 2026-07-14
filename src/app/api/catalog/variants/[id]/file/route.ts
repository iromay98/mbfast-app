import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { storage } from "@/server/storage";
import { fileResponse, logCatalogDownload } from "@/server/catalog/download-log";
import { buildDownloadName, composeContent, extFromName } from "@/server/catalog/filename";

// 本店専用: TunedVariant の現行ファイルをダウンロード。DEALER は一律 403。
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (user.role !== "HQ_ADMIN") return new Response("Forbidden", { status: 403 });

  const { id } = await ctx.params;
  const v = await prisma.tunedVariant.findUnique({
    where: { id },
    select: {
      fileRef: true,
      fileName: true,
      fileHash: true,
      contentType: true,
      currentVersionId: true,
      stage: true,
      popsAndBangs: true,
      popsSport: true,
      optionTags: true,
      baseFile: {
        select: { model: true, generation: true, calNumber: true, method: true, tool: true, driver: true, unit: true },
      },
    },
  });
  if (!v || !v.fileRef) return new Response("Not Found", { status: 404 });

  const file = await storage.read(v.fileRef);
  if (!file) return new Response("Not Found", { status: 404 });

  await logCatalogDownload({
    variantId: id,
    versionId: v.currentVersionId,
    fileHash: v.fileHash,
    userId: user.id,
    context: "HQ_MANUAL",
    ip: request.headers.get("x-forwarded-for"),
  });

  const name = buildDownloadName({
    model: v.baseFile.model,
    generation: v.baseFile.generation,
    // カタログ命名: 車種 Cal（無ければDriver） AT_方法_内容
    cal: v.baseFile.calNumber || v.baseFile.driver,
    method: v.baseFile.method,
    tool: v.baseFile.tool,
    content: composeContent(v.stage, v.popsAndBangs, v.optionTags, v.popsSport),
    unit: v.baseFile.unit,
    ext: extFromName(v.fileName, "bin"),
  });
  return fileResponse(file, name, v.contentType);
}
