"use server";

import { AuthError } from "next-auth";
import { redirect } from "next/navigation";
import { signIn, signOut } from "@/auth";

// ログイン（Credentials）。成功時は signIn が redirect を throw する。
export async function authenticate(
  _prevState: string | undefined,
  formData: FormData,
): Promise<string | undefined> {
  try {
    await signIn("credentials", {
      email: formData.get("email"),
      password: formData.get("password"),
      redirectTo: "/", // proxy がロールに応じて /hq or /dealer へ振り分け
    });
  } catch (error) {
    if (error instanceof AuthError) {
      return "メールアドレスまたはパスワードが正しくありません";
    }
    throw error; // redirect 例外などはそのまま伝播させる
  }
  return undefined;
}

export async function logout(): Promise<void> {
  // signOut 自体が redirect すると <form action> 経由で
  // 「An unexpected response was received from the server」が出るため、
  // Cookie クリアのみ行い（redirect:false でも実行される）、遷移は Next の redirect で行う。
  await signOut({ redirect: false });
  redirect("/login");
}
