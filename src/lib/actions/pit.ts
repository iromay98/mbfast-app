"use server";

import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { requireHQ } from "@/lib/authz";
import { type FormState, zodToFieldErrors } from "@/lib/actions/form-state";
import { runPitPipeline } from "@/server/pit/pipeline";

// ── mbPIT 店舗マスタ（本部のみ） ─────────────────

const storeSchema = z.object({
  dealerId: z.string().min(1, "店舗（代理店）を選択してください"),
  displayName: z.string().trim().min(1, "表示名は必須です"),
  wpCategoryId: z.coerce.number().int().positive("WordPressカテゴリIDが正しくありません"),
  storeSlug: z
    .string()
    .trim()
    .min(1, "店舗slugは必須です")
    .regex(/^[a-z0-9-]+$/, "slugは半角英小文字・数字・ハイフンのみ"),
  footerHtml: z.string().optional().default(""),
  active: z.coerce.boolean(),
});

export async function upsertPitStore(_prev: FormState, formData: FormData): Promise<FormState> {
  await requireHQ();
  const parsed = storeSchema.safeParse({
    dealerId: formData.get("dealerId"),
    displayName: formData.get("displayName"),
    wpCategoryId: formData.get("wpCategoryId"),
    storeSlug: formData.get("storeSlug"),
    footerHtml: formData.get("footerHtml"),
    active: formData.get("active") === "on" || formData.get("active") === "true",
  });
  if (!parsed.success) {
    return { error: "入力内容を確認してください", fieldErrors: zodToFieldErrors(parsed.error) };
  }
  const { dealerId, ...data } = parsed.data;
  await prisma.pitStore.upsert({
    where: { dealerId },
    create: { dealerId, ...data },
    update: data,
  });
  revalidatePath("/hq/pit");
  return { ok: true };
}

// ── 保留/失敗投稿の操作（本部のみ） ───────────────

/** FAILED の投稿を再実行する（ガード判定は通常どおり）。 */
export async function retryPitPost(postId: string): Promise<void> {
  await requireHQ();
  const post = await prisma.pitPost.findUnique({ where: { id: postId }, select: { status: true } });
  if (!post || post.status !== "FAILED") return;
  await prisma.pitPost.update({
    where: { id: postId },
    data: { status: "PROCESSING", error: null },
  });
  revalidatePath("/hq/pit");
  after(() => runPitPipeline(postId));
}

/** HELD の投稿を本部確認済みとして公開する（公開ブロック判定のみスキップ）。 */
export async function publishHeldPitPost(postId: string): Promise<void> {
  await requireHQ();
  const post = await prisma.pitPost.findUnique({ where: { id: postId }, select: { status: true } });
  if (!post || post.status !== "HELD") return;
  await prisma.pitPost.update({
    where: { id: postId },
    data: { status: "PROCESSING", holdReason: null },
  });
  revalidatePath("/hq/pit");
  after(() => runPitPipeline(postId, { skipBlockGuard: true }));
}
