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
      baseFileId: true,
      fileRef: true,
      fileName: true,
      fileHash: true,
      contentType: true,
      currentVersionId: true,
      stage: true,
      popsAndBangs: true,
      popsSport: true,
      optionTags: true,
      // 現行版の ver名と内部連番（ファイル名に付けて、どの版のbinかを識別できるようにする）
      currentVersion: { select: { label: true, version: true } },
      baseFile: {
        select: { model: true, generation: true, calNumber: true, swNumber: true, method: true, tool: true, driver: true, unit: true },
      },
    },
  });
  if (!v || !v.fileRef) return new Response("Not Found", { status: 404 });

  // 記録スコープ（?recordId=）が付いていれば顧客名をファイル名に載せる。
  // 誤って別の記録の顧客名が付かないよう、その記録の照合先(matchedBaseFile)が
  // この variant のベースと一致することを確認する（不一致・不存在なら顧客名なしでフォールバック）。
  const recordId = request.nextUrl.searchParams.get("recordId");
  let customerName: string | null = null;
  if (recordId) {
    const rec = await prisma.serviceRecord.findUnique({
      where: { id: recordId },
      select: { matchedBaseFileId: true, customerName: true },
    });
    if (rec && rec.matchedBaseFileId === v.baseFileId) {
      customerName = rec.customerName;
    }
  }

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

  // 本部Bin命名: 車種 [顧客名様] Cal(無ければSW/Driver) AT_方法_内容[_ver表記]
  // ver表記は「ver名」があればそれを、無ければ内部連番で「ver12」。
  // # はファイル名で誤解を招くため使わない（ver に統一）。
  const verLabel = (v.currentVersion?.label ?? "").trim();
  const verTag = verLabel
    ? verLabel
    : v.currentVersion
      ? `ver${v.currentVersion.version}`
      : "";
  const content =
    composeContent(v.stage, v.popsAndBangs, v.optionTags, v.popsSport) +
    (verTag ? `_${verTag}` : "");
  const name = buildDownloadName({
    model: v.baseFile.model,
    generation: v.baseFile.generation,
    // Cal を最優先。無ければ SW、それも無ければ Driver。
    cal: v.baseFile.calNumber || v.baseFile.swNumber || v.baseFile.driver,
    method: v.baseFile.method,
    tool: v.baseFile.tool,
    content,
    unit: v.baseFile.unit,
    // 記録スコープ時のみ顧客名を付与（本部Bin DLのみ・.slave側の命名は不変）
    customerName,
    ext: extFromName(v.fileName, "bin"),
  });
  return fileResponse(file, name, v.contentType);
}
