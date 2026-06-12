"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { requireHQ } from "@/lib/authz";
import { dealerSchema, dealerAccountSchema } from "@/lib/validation/dealer";
import {
  type FormState,
  zodToFieldErrors,
} from "@/lib/actions/form-state";
import { notify } from "@/server/notifications";

function parseDealerForm(formData: FormData) {
  return dealerSchema.safeParse({
    name: formData.get("name"),
    address: formData.get("address"),
    lat: formData.get("lat"),
    lng: formData.get("lng"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    autotunerToolId: formData.get("autotunerToolId"),
    note: formData.get("note"),
    status: formData.get("status") ?? "ACTIVE",
  });
}

// 新規代理店作成 → 詳細へリダイレクト
export async function createDealer(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireHQ();
  const parsed = parseDealerForm(formData);
  if (!parsed.success) {
    return { error: "入力内容を確認してください", fieldErrors: zodToFieldErrors(parsed.error) };
  }
  const dealer = await prisma.dealer.create({ data: parsed.data });
  revalidatePath("/hq/dealers");
  redirect(`/hq/dealers/${dealer.id}`);
}

// 代理店更新
export async function updateDealer(
  dealerId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireHQ();
  const parsed = parseDealerForm(formData);
  if (!parsed.success) {
    return { error: "入力内容を確認してください", fieldErrors: zodToFieldErrors(parsed.error) };
  }
  await prisma.dealer.update({ where: { id: dealerId }, data: parsed.data });
  revalidatePath("/hq/dealers");
  revalidatePath(`/hq/dealers/${dealerId}`);
  return { ok: true };
}

// 有効 / 無効の切替
export async function toggleDealerStatus(dealerId: string): Promise<void> {
  await requireHQ();
  const dealer = await prisma.dealer.findUnique({ where: { id: dealerId } });
  if (!dealer) return;
  await prisma.dealer.update({
    where: { id: dealerId },
    data: { status: dealer.status === "ACTIVE" ? "INACTIVE" : "ACTIVE" },
  });
  revalidatePath("/hq/dealers");
  revalidatePath(`/hq/dealers/${dealerId}`);
}

// 代理店ログインアカウント発行（初期パスワードを生成して一度だけ返す）
function generatePassword(len = 10): string {
  // 紛らわしい文字を除いた読みやすいパスワード
  const chars = "abcdefghijkmnpqrstuvwxyz23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
  let out = "";
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < len; i++) out += chars[bytes[i] % chars.length];
  return out;
}

export async function issueDealerAccount(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireHQ();
  const parsed = dealerAccountSchema.safeParse({
    dealerId: formData.get("dealerId"),
    name: formData.get("name"),
    email: formData.get("email"),
  });
  if (!parsed.success) {
    return { error: "入力内容を確認してください", fieldErrors: zodToFieldErrors(parsed.error) };
  }
  const { dealerId, name, email } = parsed.data;

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return { error: "このメールアドレスは既に使用されています", fieldErrors: { email: "使用済み" } };
  }

  const password = generatePassword();
  const passwordHash = await bcrypt.hash(password, 10);
  await prisma.user.create({
    data: { email, name, passwordHash, role: "DEALER", dealerId },
  });

  await notify({
    type: "DEALER_ACCOUNT_ISSUED",
    title: "代理店アカウントを発行しました",
    message: `${name} (${email}) のログインアカウントを発行しました。`,
    dealerId,
  });

  revalidatePath(`/hq/dealers/${dealerId}`);
  // 初期パスワードは一度だけ画面に表示する
  return { ok: true, data: { email, password } };
}
