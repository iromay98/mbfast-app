"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { requireHQ } from "@/lib/authz";
import { createStoreCategory, wpConfigured } from "@/server/pit/wordpress";
import { notify } from "@/server/notifications";

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

// ── mbPIT加盟店の招待・自己登録・承認 ──────────────────────────────

// 招待リンクの発行（本部のみ）。トークンは推測不能・単回使用。
export async function createPitInvite(note: string): Promise<{ ok?: true; token?: string; error?: string }> {
  await requireHQ();
  const token = randomBytes(24).toString("base64url");
  await prisma.pitInvite.create({ data: { token, note: note.trim() } });
  revalidatePath(PIT_PATH);
  return { ok: true, token };
}

// 未使用の招待リンクを取消（本部のみ）
export async function deletePitInvite(id: string): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  const invite = await prisma.pitInvite.findUnique({ where: { id }, select: { usedAt: true } });
  if (!invite) return { error: "招待が見つかりません" };
  if (invite.usedAt) return { error: "使用済みの招待は削除できません" };
  await prisma.pitInvite.delete({ where: { id } });
  revalidatePath(PIT_PATH);
  return { ok: true };
}

// 店舗の承認（本部のみ・ワンタップ）。WPカテゴリ未作成なら親545配下に自動作成してから有効化する。
export async function approvePitStore(
  storeId: string,
): Promise<{ ok?: true; error?: string; createdCategoryId?: number }> {
  await requireHQ();
  const store = await prisma.pitStore.findUnique({
    where: { id: storeId },
    select: { id: true, displayName: true, slug: true, wpCategoryId: true, active: true },
  });
  if (!store) return { error: "店舗が見つかりません" };

  let wpCategoryId = store.wpCategoryId;
  let createdCategoryId: number | undefined;
  if (wpCategoryId <= 0) {
    if (!wpConfigured()) {
      return { error: "WordPress接続が未設定のためカテゴリを自動作成できません" };
    }
    try {
      wpCategoryId = await createStoreCategory(store.displayName, store.slug);
      createdCategoryId = wpCategoryId;
    } catch (e) {
      return { error: e instanceof Error ? e.message : "WordPressカテゴリの自動作成に失敗しました" };
    }
  }
  await prisma.pitStore.update({ where: { id: storeId }, data: { wpCategoryId, active: true } });
  revalidatePath(PIT_PATH);
  return { ok: true, createdCategoryId };
}

// 招待トークンによる加盟店の自己登録（ログイン不要・トークンが実質の認証）。
// アカウント（Dealer+User）と店舗（PitStore, 承認待ち）をまとめて作成する。
// 作成される Dealer は pitOnly=true — ブログ投稿以外の画面（ECU系）は一切見せない。
export async function registerPitStore(input: {
  token: string;
  storeName: string;
  slug: string;
  contactName: string;
  email: string;
  password: string;
}): Promise<{ ok?: true; error?: string; approved?: boolean }> {
  const token = input.token.trim();
  const storeName = input.storeName.trim();
  const slug = input.slug.trim().toLowerCase();
  const contactName = input.contactName.trim();
  const email = input.email.trim().toLowerCase();

  if (!token) return { error: "招待トークンがありません" };
  if (!storeName) return { error: "店舗名を入力してください" };
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) {
    return { error: "URL名（slug）は英小文字・数字・ハイフンの3〜40文字にしてください" };
  }
  if (!contactName) return { error: "担当者名を入力してください" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "メールアドレスの形式が正しくありません" };
  if (input.password.length < 8) return { error: "パスワードは8文字以上にしてください" };

  const invite = await prisma.pitInvite.findUnique({ where: { token } });
  if (!invite || invite.usedAt) return { error: "この招待リンクは無効です（使用済みまたは取消済み）。本部にお問い合わせください" };

  const [slugTaken, emailTaken] = await Promise.all([
    prisma.pitStore.findUnique({ where: { slug }, select: { id: true } }),
    prisma.user.findUnique({ where: { email }, select: { id: true } }),
  ]);
  if (slugTaken) return { error: "このURL名（slug）は既に使われています。別の名前にしてください" };
  if (emailTaken) return { error: "このメールアドレスは既に登録されています" };

  const passwordHash = await bcrypt.hash(input.password, 10);
  let storeId: string | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      // 招待の使用マークを先に取り合う（二重送信・同時使用のガード）
      const used = await tx.pitInvite.updateMany({
        where: { id: invite.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      if (used.count === 0) throw new Error("INVITE_USED");
      const dealer = await tx.dealer.create({
        data: { name: storeName, email, pitOnly: true },
      });
      await tx.user.create({
        data: { email, name: contactName, passwordHash, role: "DEALER", dealerId: dealer.id },
      });
      const store = await tx.pitStore.create({
        data: { dealerId: dealer.id, displayName: storeName, slug, wpCategoryId: 0, active: false },
      });
      storeId = store.id;
      await tx.pitInvite.update({ where: { id: invite.id }, data: { storeId: store.id } });
    });
  } catch (e) {
    if (e instanceof Error && e.message === "INVITE_USED") {
      return { error: "この招待リンクは使用済みです" };
    }
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("Unique constraint")) return { error: "店舗名・slug・メールのいずれかが既に登録されています" };
    console.error("mbPIT: 加盟店の自己登録に失敗", e);
    return { error: "登録に失敗しました。時間をおいて再度お試しください" };
  }

  // 自動承認: 招待リンク自体が本部発行（＝信頼の担保）なので、登録と同時に
  // WPカテゴリを作成して有効化する。WP接続エラー時のみ従来の「承認待ち」に落とす。
  let approved = false;
  if (storeId && wpConfigured()) {
    try {
      const catId = await createStoreCategory(storeName, slug);
      await prisma.pitStore.update({
        where: { id: storeId },
        data: { wpCategoryId: catId, active: true },
      });
      approved = true;
    } catch (e) {
      console.error("mbPIT: 自動承認（WPカテゴリ作成）に失敗。承認待ちのままにします", e);
    }
  }

  await notify({
    type: "PIT_STORE_APPLIED",
    title: approved ? "mbPIT 新規加盟店が登録されました（自動承認済み）" : "mbPIT 新規加盟店の登録（承認待ち）",
    message: approved
      ? `${storeName}（slug: ${slug} / 担当: ${contactName}）が招待リンクから登録し、自動承認されました。WordPress側の店舗ページ（/mbpit/${slug}/）の作成を忘れずに。`
      : `${storeName}（slug: ${slug} / 担当: ${contactName}）が招待リンクから登録しました。WPカテゴリ自動作成に失敗したため、管理画面から承認してください。`,
    link: PIT_PATH,
  });
  // 注意: ここで revalidatePath を呼ぶと登録ページ自体が再レンダリングされ、
  // トークンが使用済み→「無効」画面に変わって完了画面が消える。/hq/pit は force-dynamic なので不要。
  return { ok: true, approved };
}
