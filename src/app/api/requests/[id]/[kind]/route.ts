import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { storage } from "@/server/storage";
import { filenameFromKey } from "@/server/storage/filename";
import { contentDisposition } from "@/server/catalog/filename";

// 依頼ファイルの認可付きダウンロード。
//   kind = "input"  : 代理店がアップした読み出しファイル
//   kind = "result" : 本店が返す成果ファイル
// 親(FileRequest)のアクセス権を確認してから添付ファイルとして返す。
export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string; kind: string }> },
) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id, kind } = await ctx.params;
  if (kind !== "input" && kind !== "result") {
    return new Response("Not Found", { status: 404 });
  }

  const req = await prisma.fileRequest.findUnique({
    where: { id },
    select: { dealerId: true, inputFilePath: true, resultFilePath: true, serviceRecordId: true },
  });
  if (!req) return new Response("Not Found", { status: 404 });

  // 代理店は自店の依頼のみ。本店は全件可。
  if (user.role === "DEALER" && user.dealerId !== req.dealerId) {
    return new Response("Forbidden", { status: 403 });
  }
  // 記録に紐づくチケットの「成果(生bin)」は代理店に渡さない（必ず .slave 経由）。
  // 専門情報の非表示ポリシー: チューニング済みの生binは御法度。
  if (kind === "result" && req.serviceRecordId && user.role !== "HQ_ADMIN") {
    return new Response("Forbidden", { status: 403 });
  }

  const key = kind === "input" ? req.inputFilePath : req.resultFilePath;
  if (!key) return new Response("Not Found", { status: 404 });

  const file = await storage.read(key);
  if (!file) return new Response("Not Found", { status: 404 });

  const filename = filenameFromKey(key);
  return new Response(new Uint8Array(file.buffer), {
    status: 200,
    headers: {
      // 成果/入力ファイルはダウンロードさせる（添付）
      "Content-Type": "application/octet-stream",
      "Content-Length": String(file.size),
      "Content-Disposition": contentDisposition(filename),
      "Cache-Control": "private, no-store",
    },
  });
}
