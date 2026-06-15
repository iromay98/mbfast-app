"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/authz";
import { saveUpload } from "@/server/storage";
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
    const saved = await saveUpload(file, "record-messages");
    if (!saved.ok) return { error: saved.error };
    fileFields = {
      filePath: saved.key,
      fileName: saved.filename,
      fileSize: saved.size,
      contentType: saved.contentType,
    };
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
