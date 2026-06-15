"use server";

import bcrypt from "bcryptjs";
import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/auth";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/authz";

export type AuthState = { error?: string; ok?: boolean };

// ログイン（Credentials）。
// サーバーアクション内で redirect すると、設定直後のセッションCookieが
// リダイレクト先に間に合わず /login に弾き返される（初回やり直し→2回目エラー→リロードで通る）。
// そこで redirect:false で「Cookieを確定させて返す」だけにし、遷移はクライアントで全画面遷移する。
export async function authenticate(
  _prevState: AuthState | undefined,
  formData: FormData,
): Promise<AuthState> {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirect: false,
    });
    return { ok: true };
  } catch (error) {
    if (error instanceof AuthError) {
      return { error: "メールアドレスまたはパスワードが正しくありません" };
    }
    throw error;
  }
}

// 本人によるパスワード変更。現在PWを検証 → 新PWへ更新し passwordChangedAt を記録。
// 以後、本部は変更後のPWを知り得ない（ハッシュ保存・初期PWのみ把握可）。
export async function changePassword(
  _prev: AuthState | undefined,
  formData: FormData,
): Promise<AuthState> {
  const user = await getSessionUser();
  if (!user) return { error: "ログインが必要です" };

  const current = String(formData.get("current") ?? "");
  const next = String(formData.get("next") ?? "");
  const confirm = String(formData.get("confirm") ?? "");

  if (next.length < 8) return { error: "新しいパスワードは8文字以上にしてください" };
  if (next !== confirm) return { error: "確認用パスワードが一致しません" };
  if (current === next) return { error: "現在と異なるパスワードにしてください" };

  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { passwordHash: true },
  });
  if (!dbUser) return { error: "ユーザーが見つかりません" };

  const valid = await bcrypt.compare(current, dbUser.passwordHash);
  if (!valid) return { error: "現在のパスワードが正しくありません" };

  const passwordHash = await bcrypt.hash(next, 10);
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordHash, passwordChangedAt: new Date() },
  });
  return { ok: true };
}

export async function logout(): Promise<void> {
  // signOut 自体が redirect すると <form action> 経由で
  // 「An unexpected response was received from the server」が出るため、
  // Cookie クリアのみ行い（redirect:false でも実行される）、遷移は Next の redirect で行う。
  await signOut({ redirect: false });
  redirect("/login");
}
