import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { storage, type StoredFile } from "@/server/storage";
import { encryptSlave } from "@/server/autotuner/client";
import { fileResponse } from "@/server/catalog/download-log";
import { buildDownloadName, dateLabel } from "@/server/catalog/filename";

// 実車開発モード: 現在ノードのファイルを配信する。
// 代理店には .slave（車固有IDで再暗号化）のみ。MASTER形式の代理店（Powergate等）には生bin。
// 常に「現在ノード」だけを配信し、ノードIDの指定は受け付けない（先のノードの覗き見防止）。
export async function GET(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });

  const { id: recordId } = await ctx.params;
  const record = await prisma.serviceRecord.findUnique({
    where: { id: recordId },
    select: {
      id: true,
      dealerId: true,
      devMode: true,
      devCurrentNodeId: true,
      carModel: true,
      customerName: true,
      workedAt: true,
      unit: true,
      autotunerSlaveId: true,
      autotunerEcuId: true,
      autotunerModelId: true,
      autotunerMcuId: true,
      dealer: { select: { name: true, fileFormat: true } },
    },
  });
  if (!record) return new Response("Not Found", { status: 404 });

  const isHQ = user.role === "HQ_ADMIN";
  if (!isHQ && user.dealerId !== record.dealerId) return new Response("Forbidden", { status: 403 });
  if (!record.devMode || !record.devCurrentNodeId) {
    return new Response("開発モードが有効ではありません", { status: 409 });
  }

  const node = await prisma.devNode.findUnique({
    where: { id: record.devCurrentNodeId },
    select: { id: true, recordId: true, label: true, filePath: true, fileHash: true, fileIsSlave: true },
  });
  if (!node || node.recordId !== recordId || !node.filePath) {
    return new Response("現在のノードにファイルがありません", { status: 404 });
  }

  const content = `dev_${node.label.replace(/\s+/g, "")}`;
  const nameBase = {
    model: record.carModel,
    method: "OBD",
    content,
    unit: record.unit,
    dealerName: record.dealer?.name,
    customerName: record.customerName,
    dateLabel: dateLabel(record.workedAt),
  };

  // チャット添付から取り込んだ暗号化済み .slave ノード: 再暗号化せずそのまま配信
  if (node.fileIsSlave) {
    const f = await storage.read(node.filePath);
    if (!f) return new Response("Not Found", { status: 404 });
    const out: StoredFile = { buffer: f.buffer, contentType: "application/octet-stream", size: f.buffer.byteLength };
    return fileResponse(out, buildDownloadName({ ...nameBase, ext: "slave" }), out.contentType);
  }

  // MASTER形式（Powergate等）の代理店は生binのまま
  if (!isHQ && record.dealer?.fileFormat === "MASTER") {
    const tuned = await storage.read(node.filePath);
    if (!tuned) return new Response("Not Found", { status: 404 });
    const out: StoredFile = { buffer: tuned.buffer, contentType: "application/octet-stream", size: tuned.buffer.byteLength };
    return fileResponse(out, buildDownloadName({ ...nameBase, ext: "bin" }), out.contentType);
  }

  // 本店は生binを直接確認できる（?raw=1）
  if (isHQ && request.nextUrl.searchParams.get("raw") === "1") {
    const tuned = await storage.read(node.filePath);
    if (!tuned) return new Response("Not Found", { status: 404 });
    const out: StoredFile = { buffer: tuned.buffer, contentType: "application/octet-stream", size: tuned.buffer.byteLength };
    return fileResponse(out, buildDownloadName({ ...nameBase, ext: "bin" }), out.contentType);
  }

  // .slave 化（車固有ID・復号時に保存されたもの）
  const { autotunerSlaveId: slaveId, autotunerEcuId: ecuId, autotunerModelId: modelId, autotunerMcuId: mcuId } = record;
  if (!slaveId || ecuId == null || modelId == null || !mcuId) {
    return new Response("この記録には再暗号化に必要な情報がありません", { status: 409 });
  }

  const cacheKey = `records/dev/encrypted/${node.fileHash ?? node.id}__${slaveId}.slave`;
  let slaveData: Buffer;
  const cached = await storage.read(cacheKey);
  if (cached) {
    slaveData = cached.buffer;
  } else {
    const tuned = await storage.read(node.filePath);
    if (!tuned) return new Response("Not Found", { status: 404 });
    try {
      const enc = await encryptSlave(tuned.buffer, { slaveId, ecuId, modelId, mcuId }, { recordId });
      slaveData = enc.slaveData;
      await storage.save(cacheKey, slaveData, "application/octet-stream");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return new Response(`再暗号化に失敗しました: ${msg}`, { status: 502 });
    }
  }

  const out: StoredFile = { buffer: slaveData, contentType: "application/octet-stream", size: slaveData.byteLength };
  return fileResponse(out, buildDownloadName({ ...nameBase, ext: "slave" }), out.contentType);
}
