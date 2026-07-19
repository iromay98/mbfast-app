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

// メッセージへのアクセス可否（記録経由）。返り値に自分がHQ/代理店かも含む。
async function authzMessage(messageId: string) {
  const user = await getSessionUser();
  if (!user) return null;
  const msg = await prisma.recordMessage.findUnique({
    where: { id: messageId },
    select: {
      id: true,
      authorId: true,
      authorRole: true,
      serviceRecordId: true,
      serviceRecord: { select: { dealerId: true } },
    },
  });
  if (!msg) return null;
  if (user.role === "DEALER" && user.dealerId !== msg.serviceRecord.dealerId) return null;
  return { user, msg };
}

// 送信取り消し（自分の投稿のみ。本部は自分の投稿を、代理店は自分の投稿を取り消せる）。
// 本文/添付は配信停止し、「送信を取り消しました」と表示する。
export async function retractMessage(
  messageId: string,
): Promise<{ ok?: true; error?: string }> {
  const ctx = await authzMessage(messageId);
  if (!ctx) return { error: "権限がありません" };
  if (ctx.msg.authorId !== ctx.user.id && ctx.user.role !== "HQ_ADMIN") {
    return { error: "自分の送信のみ取り消せます" };
  }
  await prisma.recordMessage.update({
    where: { id: messageId },
    data: { deletedAt: new Date() },
  });
  revalidatePath(`/hq/records/${ctx.msg.serviceRecordId}`);
  revalidatePath(`/dealer/records/${ctx.msg.serviceRecordId}`);
  return { ok: true };
}

// 添付ファイルの備考（本部/代理店それぞれが自分の欄に記入）。
export async function setMessageFileNote(
  messageId: string,
  note: string,
): Promise<{ ok?: true; error?: string }> {
  const ctx = await authzMessage(messageId);
  if (!ctx) return { error: "権限がありません" };
  const isHQ = ctx.user.role === "HQ_ADMIN";
  await prisma.recordMessage.update({
    where: { id: messageId },
    data: isHQ ? { hqNote: note.trim() || null } : { dealerNote: note.trim() || null },
  });
  revalidatePath(`/hq/records/${ctx.msg.serviceRecordId}`);
  revalidatePath(`/dealer/records/${ctx.msg.serviceRecordId}`);
  return { ok: true };
}

// 本部が添付の再DL可否を切替（false=以後、代理店はDL不可）。
export async function setMessageRedownloadable(
  messageId: string,
  redownloadable: boolean,
): Promise<{ ok?: true; error?: string }> {
  const ctx = await authzMessage(messageId);
  if (!ctx) return { error: "権限がありません" };
  if (ctx.user.role !== "HQ_ADMIN") return { error: "本部のみ設定できます" };
  await prisma.recordMessage.update({
    where: { id: messageId },
    data: { redownloadable },
  });
  revalidatePath(`/hq/records/${ctx.msg.serviceRecordId}`);
  revalidatePath(`/dealer/records/${ctx.msg.serviceRecordId}`);
  return { ok: true };
}

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
          backupSupported: true,
          primarySide: true,
          dealer: { select: { name: true } },
          matchedBaseFile: {
            select: { model: true, generation: true, calNumber: true, method: true, tool: true, },
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
      // 種類: maps=マップのみ（既定） / backup=ECU全内容（bak・マップスイッチ用）
      const mode =
        formData.get("encryptMode") === "backup" ? ("backup" as const) : ("maps" as const);
      // 左右ECU: bak のときだけ側を選べる（encryptSide=RecordEcuSide.id）。cal(.slave)は左右共通。
      const sideId = String(formData.get("encryptSide") ?? "").trim();
      let encSide: { side: string; backupSupported: boolean | null; ids: { slaveId: string; ecuId: number; modelId: number; mcuId: string } } | null = null;
      if (mode === "backup" && sideId) {
        const sr = await prisma.recordEcuSide.findUnique({
          where: { id: sideId },
          select: {
            recordId: true,
            side: true,
            backupSupported: true,
            autotunerSlaveId: true,
            autotunerEcuId: true,
            autotunerModelId: true,
            autotunerMcuId: true,
          },
        });
        if (!sr || sr.recordId !== recordId) return { error: "側の指定が不正です" };
        if (!sr.autotunerSlaveId || sr.autotunerEcuId == null || sr.autotunerModelId == null || !sr.autotunerMcuId) {
          return { error: "この側には暗号化IDがありません" };
        }
        encSide = {
          side: sr.side,
          backupSupported: sr.backupSupported,
          ids: { slaveId: sr.autotunerSlaveId, ecuId: sr.autotunerEcuId, modelId: sr.autotunerModelId, mcuId: sr.autotunerMcuId },
        };
      }
      if (mode === "backup" && (encSide ? encSide.backupSupported : rec?.backupSupported) === false) {
        return { error: "このECUは backup（フル読み書き）に対応していないため bak は作れません。" };
      }
      // アップされたファイルはそのまま AutoTuner へ渡す（zipもそのまま。
      // 展開や中身の選別はしない＝AutoTuner側が扱う）。
      const tuned = Buffer.from(await file.arrayBuffer());
      const innerName: string | null = file.name || null;
      let slaveData: Buffer;
      try {
        const enc = await encryptSlave(
          tuned,
          encSide ? encSide.ids : { slaveId, ecuId, modelId, mcuId },
          { recordId, mode },
        );
        slaveData = enc.slaveData;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { error: `暗号化に失敗しました（チューニング後binでない場合はチェックを外してください）: ${msg}` };
      }
      // 代理店DLと同じ構造化ファイル名（車種(世代) 代理店名(顧客名+日付) AT_method_内容.slave）。
      // 内容は本店が入力（例 Stage1_Pops_AdBlue）。未入力は元ファイル名の語幹を流用。
      // ファイル名: 本店が入力した名前を最優先（.slave は自動付与）。
      // 未入力なら従来の自動命名（車種(世代) 店名(顧客名 日付) Cal AT_方法_内容.slave）。
      const nameInput = String(formData.get("fileName") ?? "")
        .trim()
        .replace(/[\\/:*?"<>|]/g, "_"); // パス・禁止文字は除去
      const contentInput = String(formData.get("content") ?? "").trim();
      const fallback = (innerName || file.name || "test").replace(/\.[^.]+$/, "");
      // bak(フルバックアップ)は内容名にも bak を入れて区別する
      const contentBase = contentInput || fallback;
      const fileName = nameInput
        ? nameInput.toLowerCase().endsWith(".slave")
          ? nameInput
          : `${nameInput}.slave`
        : buildDownloadName({
            model: rec?.matchedBaseFile?.model ?? rec?.carModel,
            generation: rec?.matchedBaseFile?.generation,
            cal: rec?.matchedBaseFile?.calNumber, // 本店なので Cal も付与
            method: rec?.matchedBaseFile?.method,
            tool: rec?.matchedBaseFile?.tool ?? undefined,
            content: mode === "backup" ? `${contentBase}_bak${encSide ? `_${encSide.side}` : ""}` : contentBase,
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
