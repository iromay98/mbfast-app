"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/authz";
import { saveUpload, storage } from "@/server/storage";
import { encryptSlave } from "@/server/autotuner/client";
import { notify } from "@/server/notifications";
import { sendPushToUsers, recipientUserIds } from "@/server/push";
import { buildDownloadName, dateLabel } from "@/server/catalog/filename";
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
  // 添付は3系統: slaveFile(本店・暗号化) / file・cameraFile(自由・撮影)。空(size0)は無視。
  const pick = (...keys: string[]): File | null => {
    for (const k of keys) {
      const v = formData.get(k);
      if (v instanceof File && v.size > 0) return v;
    }
    return null;
  };
  const slaveFile = ctx.user.role === "HQ_ADMIN" ? pick("slaveFile") : null;
  const freeFile = pick("file", "cameraFile");
  const file = slaveFile ?? freeFile;
  const hasFile = !!file;
  const wantEncrypt = !!slaveFile;
  if (!body && !hasFile) {
    return { error: "メッセージかファイルを入力してください" };
  }

  let fileFields: {
    filePath?: string;
    fileName?: string;
    fileSize?: number;
    contentType?: string;
  } = {};
  if (file) {
    // slaveFile を選んだ場合、この車固有のIDで encrypt して焼ける .slave に。
    if (wantEncrypt) {
      const rec = await prisma.serviceRecord.findUnique({
        where: { id: recordId },
        select: {
          autotunerSlaveId: true,
          autotunerEcuId: true,
          autotunerModelId: true,
          autotunerMcuId: true,
          carModel: true,
          customerName: true,
          workedAt: true,
          unit: true,
          dealer: { select: { name: true } },
          matchedBaseFile: {
            select: { model: true, generation: true, calNumber: true, method: true },
          },
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
      // 代理店DLと同じ構造化ファイル名（車種(世代) 代理店名(顧客名+日付) AT_method_内容.slave）。
      // 内容は本店が入力（例 Stage1_Pops_AdBlue）。未入力は元ファイル名の語幹を流用。
      const contentInput = String(formData.get("content") ?? "").trim();
      const fallback = (file.name || "test").replace(/\.[^.]+$/, "");
      const fileName = buildDownloadName({
        model: rec?.matchedBaseFile?.model ?? rec?.carModel,
        generation: rec?.matchedBaseFile?.generation,
        cal: rec?.matchedBaseFile?.calNumber, // 本店なので Cal も付与
        method: rec?.matchedBaseFile?.method,
        content: contentInput || fallback,
        unit: rec?.unit,
        ext: "slave",
        dealerName: rec?.dealer?.name,
        customerName: rec?.customerName,
        dateLabel: dateLabel(rec?.workedAt),
      });
      const key = `record-messages/${recordId}/${Date.now()}_${fileName}`;
      await storage.save(key, slaveData, "application/octet-stream");
      fileFields = {
        filePath: key,
        fileName,
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
  const link = fromHQ ? `/dealer/records/${recordId}` : `/hq/records/${recordId}`;
  const previewBody = body ? body.slice(0, 80) : "ファイルが届きました";
  await notify({
    type: "RECORD_MESSAGE",
    title: fromHQ ? "本部からメッセージが届きました" : "代理店からメッセージが届きました",
    message: previewBody,
    dealerId: fromHQ ? ctx.dealerId : null, // 本部→代理店宛て / 代理店→本部宛て
    link,
  });

  // Web Push（相手側へ。アプリを閉じていても届く）。レスポンス後に送信。
  after(async () => {
    const recipients = await recipientUserIds({ toHQ: !fromHQ, dealerId: ctx.dealerId });
    await sendPushToUsers(recipients, {
      title: fromHQ ? "本部からメッセージ" : "代理店からメッセージ",
      body: previewBody,
      url: link,
      tag: `record-${recordId}`,
    });
  });

  revalidatePath(`/hq/records/${recordId}`);
  revalidatePath(`/dealer/records/${recordId}`);
  return { ok: true };
}
