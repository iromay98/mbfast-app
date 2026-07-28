"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireHQ } from "@/lib/authz";
import { createStoreCategory, wpConfigured } from "@/server/pit/wordpress";

const PIT_PATH = "/hq/pit";

// 店舗マスタの作成・更新（本店のみ）。
// dealerId 空 = 本店直営（代理店に紐づけない店舗。本部が /hq/pit/post から投稿）。
// wpCategoryId 0以下 = WordPressに親545配下のカテゴリを自動作成してIDを取り込む。
export async function upsertPitStore(input: {
  id?: string;
  dealerId: string;
  displayName: string;
  slug: string;
  wpCategoryId: number;
  footerHtml: string;
  active: boolean;
}): Promise<{ ok?: true; error?: string; createdCategoryId?: number }> {
  await requireHQ();
  const displayName = input.displayName.trim();
  const slug = input.slug.trim().toLowerCase();
  if (!displayName) return { error: "表示名を入力してください" };
  if (!/^[a-z0-9-]+$/.test(slug)) return { error: "slugは英小文字・数字・ハイフンのみです" };

  const dealerId = input.dealerId.trim() || null;
  if (dealerId) {
    const dealer = await prisma.dealer.findUnique({ where: { id: dealerId }, select: { id: true } });
    if (!dealer) return { error: "代理店が見つかりません" };
  }

  let wpCategoryId = input.wpCategoryId;
  let createdCategoryId: number | undefined;
  if (!Number.isInteger(wpCategoryId) || wpCategoryId <= 0) {
    if (!wpConfigured()) {
      return { error: "WordPress接続が未設定のためカテゴリを自動作成できません。カテゴリIDを入力してください" };
    }
    try {
      wpCategoryId = await createStoreCategory(displayName, slug);
      createdCategoryId = wpCategoryId;
    } catch (e) {
      return { error: e instanceof Error ? e.message : "WordPressカテゴリの自動作成に失敗しました" };
    }
  }

  try {
    if (input.id) {
      await prisma.pitStore.update({
        where: { id: input.id },
        data: { dealerId, displayName, slug, wpCategoryId, footerHtml: input.footerHtml, active: input.active },
      });
    } else {
      await prisma.pitStore.create({
        data: { dealerId, displayName, slug, wpCategoryId, footerHtml: input.footerHtml, active: input.active },
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("Unique constraint")) return { error: "その代理店またはslugは既に登録されています" };
    return { error: "保存に失敗しました" };
  }
  revalidatePath(PIT_PATH);
  return { ok: true, createdCategoryId };
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
