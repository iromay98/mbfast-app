"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireHQ } from "@/lib/authz";

const PIT_PATH = "/hq/pit";

// 店舗マスタの作成・更新（本店のみ）。dealerId は既存代理店に紐づける。
export async function upsertPitStore(input: {
  id?: string;
  dealerId: string;
  displayName: string;
  slug: string;
  wpCategoryId: number;
  footerHtml: string;
  active: boolean;
}): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  const displayName = input.displayName.trim();
  const slug = input.slug.trim().toLowerCase();
  if (!displayName) return { error: "表示名を入力してください" };
  if (!/^[a-z0-9-]+$/.test(slug)) return { error: "slugは英小文字・数字・ハイフンのみです" };
  if (!Number.isInteger(input.wpCategoryId) || input.wpCategoryId <= 0) {
    return { error: "WordPressカテゴリIDを入力してください" };
  }
  const dealer = await prisma.dealer.findUnique({ where: { id: input.dealerId }, select: { id: true } });
  if (!dealer) return { error: "代理店が見つかりません" };

  try {
    if (input.id) {
      await prisma.pitStore.update({
        where: { id: input.id },
        data: { dealerId: input.dealerId, displayName, slug, wpCategoryId: input.wpCategoryId, footerHtml: input.footerHtml, active: input.active },
      });
    } else {
      await prisma.pitStore.create({
        data: { dealerId: input.dealerId, displayName, slug, wpCategoryId: input.wpCategoryId, footerHtml: input.footerHtml, active: input.active },
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("Unique constraint")) return { error: "その代理店またはslugは既に登録されています" };
    return { error: "保存に失敗しました" };
  }
  revalidatePath(PIT_PATH);
  return { ok: true };
}

// held投稿の処理（確認済みにする）。resolution はメモとして guardResult に追記。
export async function resolvePitHeld(
  postId: string,
  resolution: "dismissed",
  note?: string,
): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  const post = await prisma.pitPost.findUnique({ where: { id: postId }, select: { id: true, status: true, guardResult: true } });
  if (!post) return { error: "投稿が見つかりません" };
  if (post.status !== "held") return { error: "保留中の投稿ではありません" };
  await prisma.pitPost.update({
    where: { id: postId },
    data: {
      status: "failed",
      errorMessage: `本部確認済み（自動公開せず）${note ? `: ${note}` : ""}`,
    },
  });
  void resolution;
  revalidatePath(PIT_PATH);
  return { ok: true };
}
