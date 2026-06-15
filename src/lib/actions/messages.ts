"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/authz";
import { saveUpload, storage } from "@/server/storage";
import { encryptSlave } from "@/server/autotuner/client";
import { notify } from "@/server/notifications";
import { type FormState } from "@/lib/actions/form-state";

// 案件(施工記録)へのアクセス可否。本店は全件、代理店は自店のみ。
async function authzRecord(recordId: string) {
  const user = await getSessionUser();
  if (!user) return null;
  const rec = await prisma.serviceRecord.findUnique({
    where: { id: recordId },
    select: { dealerId: true },
  });
  if (!rec) return null;
  if (user.role === "DEALER" && user.dealerId !== rec.dealerId) return null;
  return { user, dealerId: rec.dealerId };
}

// 案件ごとのメッセージ投稿（本部→テストファイル/返信、代理店→質問/別リクエスト）。
export async function postRecordMessage(
  recordId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const ctx = await authzRecord(recordId);
  if (!ctx) return { error: "権限がありません" };

  const body = String(formData.get("body") ?? "").trim();
  const file = formData.get("file");
  const hasFile = file instanceof File && file.size > 0;
  if (!body && !hasFile) {
    return { error: "メッセージかファイルを入力してください" };
  }

  let fileFields: {
    filePath?: string;
    fileName?: string;
    fileSize?: number;
    contentType?: string;
  } = {};
  if (hasFile) {
    // 本店が「.slaveに暗号化して送る」を選んだ場合、この車固有のIDで encrypt して焼ける.slaveに。
    const wantEncrypt = formData.get("encrypt") === "true" && ctx.user.role === "HQ_ADMIN";
    if (wantEncrypt) {
      const rec = await prisma.serviceRecord.findUnique({
        where: { id: recordId },
        select: {
          autotunerSlaveId: true,
          autotunerEcuId: true,
          autotunerModelId: true,
          autotunerMcuId: true,
        },
      });
      const slaveId = rec?.autotunerSlaveId;
      const ecuId = rec?.autotunerEcuId;
      const modelId = rec?.autotunerModelId;
      const mcuId = rec?.autotunerMcuId;
      if (!slaveId || ecuId == null || modelId == null || !mcuId) {
        return { error: "この記録は暗号化IDが無いため .slave 化できません。チェックを外して送ってください。" };
      }
      const tuned = Buffer.from(await file.arrayBuffer());
      let slaveData: Buffer;
      try {
        const enc = await encryptSlave(tuned, { slaveId, ecuId, modelId, mcuId }, { recordId });
        slaveData = enc.slaveData;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { error: `暗号化に失敗しました（チューニング後binでない場合はチェックを外してください）: ${msg}` };
      }
      const stem = (file.name || "test").replace(/\.[^.]+$/, "");
      const key = `record-messages/${recordId}/${Date.now()}_${stem}.slave`;
      await storage.save(key, slaveData, "application/octet-stream");
      fileFields = {
        filePath: key,
        fileName: `${stem}.slave`,
        fileSize: slaveData.byteLength,
        contentType: "application/octet-stream",
      };
    } else {
      const saved = await saveUpload(file, "record-messages");
      if (!saved.ok) return { error: saved.error };
      fileFields = {
        filePath: saved.key,
        fileName: saved.filename,
        fileSize: saved.size,
        contentType: saved.contentType,
      };
    }
  }

  await prisma.recordMessage.create({
    data: {
      serviceRecordId: recordId,
      authorId: ctx.user.id,
      authorRole: ctx.user.role,
      body: body || null,
      ...fileFields,
    },
  });

  const fromHQ = ctx.user.role === "HQ_ADMIN";
  await notify({
    type: "RECORD_MESSAGE",
    title: fromHQ ? "本部からメッセージが届きました" : "代理店からメッセージが届きました",
    message: body ? body.slice(0, 80) : "ファイルが届きました",
    dealerId: fromHQ ? ctx.dealerId : null, // 本部→代理店宛て / 代理店→本部宛て
    link: fromHQ ? `/dealer/records/${recordId}` : `/hq/records/${recordId}`,
  });

  revalidatePath(`/hq/records/${recordId}`);
  revalidatePath(`/dealer/records/${recordId}`);
  return { ok: true };
}
