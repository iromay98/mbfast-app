"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireHQ, requireDealer } from "@/lib/authz";
import { announcementSchema } from "@/lib/validation/announcement";
import { type FormState, zodToFieldErrors } from "@/lib/actions/form-state";
import { notify } from "@/server/notifications";
import { announcementCategoryLabels } from "@/lib/labels";

function parse(formData: FormData) {
  return announcementSchema.safeParse({
    title: formData.get("title"),
    body: formData.get("body"),
    category: formData.get("category"),
  });
}

// 本店: お知らせ作成（公開）
export async function createAnnouncement(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireHQ();
  const parsed = parse(formData);
  if (!parsed.success) {
    return { error: "入力内容を確認してください", fieldErrors: zodToFieldErrors(parsed.error) };
  }
  const a = await prisma.announcement.create({
    data: { ...parsed.data, publishedById: user.id },
  });
  await notify({
    type: "ANNOUNCEMENT_PUBLISHED",
    title: `新着${announcementCategoryLabels[a.category]}`,
    message: a.title,
    dealerId: null, // 全代理店向け
    link: "/dealer/announcements",
  });
  revalidatePath("/hq/announcements");
  revalidatePath("/dealer/announcements");
  redirect("/hq/announcements");
}

// 本店: お知らせ編集
export async function updateAnnouncement(
  id: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireHQ();
  const parsed = parse(formData);
  if (!parsed.success) {
    return { error: "入力内容を確認してください", fieldErrors: zodToFieldErrors(parsed.error) };
  }
  await prisma.announcement.update({ where: { id }, data: parsed.data });
  revalidatePath("/hq/announcements");
  revalidatePath(`/hq/announcements/${id}`);
  revalidatePath("/dealer/announcements");
  return { ok: true };
}

// 代理店: 既読化（冪等）
export async function markAnnouncementRead(announcementId: string): Promise<void> {
  const user = await requireDealer();
  await prisma.announcementRead.upsert({
    where: {
      announcementId_dealerId: { announcementId, dealerId: user.dealerId },
    },
    create: { announcementId, dealerId: user.dealerId },
    update: {},
  });
  revalidatePath("/dealer/announcements");
  revalidatePath("/dealer");
}
