import { redirect } from "next/navigation";
import { getSessionUser, isSessionLive } from "@/lib/authz";
import { LoginForm } from "./login-form";

export default async function LoginPage() {
  // 既にログイン済み かつ セッションが有効ならロールのホームへ。
  // （無効化された代理店など失効済みセッションはここで弾かず、ログインフォームを表示する。
  //   保護ページ側の requireUser と同じ isSessionLive で判定を揃え、/login ⇄ /dealer の
  //   リダイレクトループを防ぐ。）
  const user = await getSessionUser();
  if (user && (await isSessionLive(user))) {
    redirect(user.role === "HQ_ADMIN" ? "/hq" : "/dealer");
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-surface-2 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="mb-2 inline-flex items-center gap-2">
            <span className="text-2xl font-black tracking-tight text-ink">
              mb<span className="text-gold-500">FAST</span>
            </span>
          </div>
          <p className="text-sm text-ink-soft">本店⇄代理店 連携アプリ</p>
        </div>
        <LoginForm />
        <p className="mt-6 text-center text-xs text-ink-soft">
          アカウントは本店が発行します
        </p>
      </div>
    </main>
  );
}
