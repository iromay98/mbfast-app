"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/auth";

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

export async function logout(): Promise<void> {
  // signOut 自体が redirect すると <form action> 経由で
  // 「An unexpected response was received from the server」が出るため、
  // Cookie クリアのみ行い（redirect:false でも実行される）、遷移は Next の redirect で行う。
  await signOut({ redirect: false });
  redirect("/login");
}
