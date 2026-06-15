import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { storage } from "@/server/storage";
import { filenameFromKey } from "@/server/storage/filename";
import { buildDownloadName, dateLabel } from "@/server/catalog/filename";

// スレーブ/復号ファイルの認可付きダウンロード。
//   kind = "slave"     : 代理店がアップしたスレーブ
//   kind = "decrypted" : 復号後バイナリ（本店がダウンロード）
// 親(ServiceRecord)のアクセス権を確認してから添付として返す。推測可能URLでの直配信はしない。
export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ id: string; kind: string }> },
) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id, kind } = await ctx.params;
  if (kind !== "slave" && kind !== "decrypted") {
    return new Response("Not Found", { status: 404 });
  }

  const record = await prisma.serviceRecord.findUnique({
    where: { id },
    select: {
      dealerId: true,
      slaveFilePath: true,
      decryptedFilePath: true,
      carModel: true,
      calNumber: true,
      method: true,
      engineInfo: true,
      customerName: true,
      workedAt: true,
      dealer: { select: { name: true } },
      matchedBaseFile: {
        select: { model: true, generation: true, calNumber: true, method: true },
      },
    },
  });
  if (!record) return new Response("Not Found", { status: 404 });

  // 代理店は自店の記録のみ。本店は全件可。
  if (user.role === "DEALER" && user.dealerId !== record.dealerId) {
    return new Response("Forbidden", { status: 403 });
  }

  // 復号(decrypt)した純正binは代理店に一切渡さない（御法度）。本店のみ。
  if (kind === "decrypted" && user.role !== "HQ_ADMIN") {
    return new Response("Forbidden", { status: 403 });
  }

  const key = kind === "slave" ? record.slaveFilePath : record.decryptedFilePath;
  if (!key) return new Response("Not Found", { status: 404 });

  const file = await storage.read(key);
  if (!file) return new Response("Not Found", { status: 404 });

  // 復号ファイルは ori 命名規則（メーカー除外）。スレーブは従来の保存名。
  let filename: string;
  if (kind === "decrypted") {
    // 命名は stock-slave(ori) と統一。照合した純正(matchedBaseFile)の
    // 車種/世代/Cal/施工方式を優先し、無ければ記録の値にフォールバック。
    const gen =
      record.matchedBaseFile?.generation ??
      (record.engineInfo as { version?: string } | null)?.version ??
      null;
    filename = buildDownloadName({
      model: record.matchedBaseFile?.model ?? record.carModel,
      generation: gen,
      // bin は本店専用なので Cal は常に付与
      cal: record.matchedBaseFile?.calNumber ?? record.calNumber,
      method: record.matchedBaseFile?.method ?? record.method,
      content: "ori",
      ext: "bin",
      // 車種名の後に「代理店名(顧客名+日付)」を付与
      dealerName: record.dealer?.name,
      customerName: record.customerName,
      dateLabel: dateLabel(record.workedAt),
    });
  } else {
    filename = filenameFromKey(key);
  }
  return new Response(new Uint8Array(file.buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Length": String(file.size),
      "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "private, no-store",
    },
  });
}
