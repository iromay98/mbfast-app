import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { storage } from "@/server/storage";
import { fileResponse, logCatalogDownload } from "@/server/catalog/download-log";
import { buildDownloadName, composeContent, extFromName } from "@/server/catalog/filename";

// 本店専用: 特定バージョンのファイルをダウンロード（履歴確認用）。DEALER は一律 403。
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ versionId: string }> },
) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (user.role !== "HQ_ADMIN") return new Response("Forbidden", { status: 403 });

  const { versionId } = await ctx.params;
  const ver = await prisma.tunedVariantVersion.findUnique({
    where: { id: versionId },
    select: {
      variantId: true,
      version: true,
      fileRef: true,
      fileName: true,
      fileHash: true,
      contentType: true,
      variant: {
        select: {
          stage: true,
          popsAndBangs: true,
          popsSport: true,
          optionTags: true,
          baseFile: {
            select: { model: true, generation: true, calNumber: true, method: true, driver: true, unit: true },
          },
        },
      },
    },
  });
  if (!ver || !ver.fileRef) return new Response("Not Found", { status: 404 });

  const file = await storage.read(ver.fileRef);
  if (!file) return new Response("Not Found", { status: 404 });

  await logCatalogDownload({
    variantId: ver.variantId,
    versionId,
    fileHash: ver.fileHash,
    userId: user.id,
    context: "HQ_MANUAL",
    ip: request.headers.get("x-forwarded-for"),
  });

  const b = ver.variant.baseFile;
  const name = buildDownloadName({
    model: b.model,
    generation: b.generation,
    // カタログ命名: 車種 Cal（無ければDriver） AT_方法_内容
    cal: b.calNumber || b.driver,
    method: b.method,
    content: `${composeContent(ver.variant.stage, ver.variant.popsAndBangs, ver.variant.optionTags, ver.variant.popsSport)}_v${ver.version}`,
    unit: b.unit,
    ext: extFromName(ver.fileName, "bin"),
  });
  return fileResponse(file, name, ver.contentType);
}
