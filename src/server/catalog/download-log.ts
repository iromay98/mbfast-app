import { prisma } from "@/lib/db";
import type { StoredFile } from "@/server/storage";
import { contentDisposition } from "@/server/catalog/filename";

/**
 * カタログDLの監査ログ（いつ・誰が・どのファイルを）。
 * 記録失敗で本処理(配信)を止めないよう握りつぶす（AutotunerApiLog の logCall と同方針）。
 */
export async function logCatalogDownload(input: {
  variantId?: string | null; // チケット(現車合わせ等)の配信は variant 無し
  versionId?: string | null;
  fileHash?: string | null;
  userId?: string | null;
  dealerId?: string | null;
  serviceRecordId?: string | null;
  context: "MATCH_AUTO" | "HQ_MANUAL";
  ip?: string | null;
}): Promise<void> {
  try {
    await prisma.catalogDownloadLog.create({
      data: {
        variantId: input.variantId ?? null,
        versionId: input.versionId ?? null,
        fileHash: input.fileHash ?? null,
        userId: input.userId ?? null,
        dealerId: input.dealerId ?? null,
        serviceRecordId: input.serviceRecordId ?? null,
        context: input.context,
        ip: input.ip ?? null,
      },
    });
  } catch {
    // ログ失敗は配信を止めない
  }
}

/** 認可済みファイルを添付ダウンロードとして返す共通ヘルパ。 */
export function fileResponse(
  file: StoredFile,
  filename: string,
  contentType?: string | null,
): Response {
  return new Response(new Uint8Array(file.buffer), {
    status: 200,
    headers: {
      "Content-Type": contentType || "application/octet-stream",
      "Content-Length": String(file.size),
      "Content-Disposition": contentDisposition(filename),
      "Cache-Control": "private, no-store",
    },
  });
}
