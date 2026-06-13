import type { NextRequest } from "next/server";
import { createHash } from "crypto";
import { getSessionUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { storage, type StoredFile } from "@/server/storage";
import { encryptSlave } from "@/server/autotuner/client";
import { fileResponse } from "@/server/catalog/download-log";
import { buildDownloadName, composeContent, dateLabel } from "@/server/catalog/filename";

// 本店のみ: 任意のチューニング後bin を、その記録の車固有ID(復号時に保存)で AutoTuner encrypt し、
// 焼ける .slave として返す。ファイル名は記録の代理店名(顧客名+日付)・車種・Cal を自動で埋める。
export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (user.role !== "HQ_ADMIN") return new Response("Forbidden", { status: 403 });

  const { id: recordId } = await ctx.params;
  const record = await prisma.serviceRecord.findUnique({
    where: { id: recordId },
    select: {
      autotunerSlaveId: true,
      autotunerEcuId: true,
      autotunerModelId: true,
      autotunerMcuId: true,
      customerName: true,
      workedAt: true,
      carModel: true,
      dealer: { select: { name: true } },
      matchedBaseFile: {
        select: { model: true, generation: true, calNumber: true, method: true },
      },
    },
  });
  if (!record) return new Response("Not Found", { status: 404 });

  // encrypt に必要なID（その車固有・復号時に保存）が揃っていなければ不可。
  const slaveId = record.autotunerSlaveId;
  const ecuId = record.autotunerEcuId;
  const modelId = record.autotunerModelId;
  const mcuId = record.autotunerMcuId;
  if (!slaveId || ecuId == null || modelId == null || !mcuId) {
    return new Response("この記録には暗号化に必要な情報(復号時のID)がありません", { status: 409 });
  }

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return new Response("チューニング後のbinを選択してください", { status: 400 });
  }
  const stage = String(form.get("stage") ?? "").trim();
  const popsMode = String(form.get("pops") ?? "none"); // none | all | sport
  const pops = popsMode !== "none";
  const popsSport = popsMode === "sport";
  let optionTags: string[] = [];
  try {
    const raw = form.get("optionTags");
    if (typeof raw === "string" && raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) optionTags = parsed.filter((t) => typeof t === "string");
    }
  } catch {
    // 無視（オプション無し扱い）
  }

  const tuned = Buffer.from(await file.arrayBuffer());
  // キャッシュ: 同じ bin(hash) × 同じ車(slaveId) は使い回す
  const tunedHash = createHash("sha256").update(tuned).digest("hex");
  const cacheKey = `records/encrypted/${tunedHash}__${slaveId}.slave`;
  let slaveData: Buffer;
  const cached = await storage.read(cacheKey);
  if (cached) {
    slaveData = cached.buffer;
  } else {
    try {
      const enc = await encryptSlave(tuned, { slaveId, ecuId, modelId, mcuId }, { recordId });
      slaveData = enc.slaveData;
      await storage.save(cacheKey, slaveData, "application/octet-stream");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return new Response(`暗号化に失敗しました: ${msg}`, { status: 502 });
    }
  }

  const name = buildDownloadName({
    model: record.matchedBaseFile?.model ?? record.carModel,
    generation: record.matchedBaseFile?.generation,
    cal: record.matchedBaseFile?.calNumber, // 本店なので Cal も付与
    method: record.matchedBaseFile?.method,
    content: composeContent(stage, pops, optionTags, popsSport),
    ext: "slave",
    dealerName: record.dealer?.name,
    customerName: record.customerName,
    dateLabel: dateLabel(record.workedAt),
  });
  const out: StoredFile = {
    buffer: slaveData,
    contentType: "application/octet-stream",
    size: slaveData.byteLength,
  };
  return fileResponse(out, name, out.contentType);
}
