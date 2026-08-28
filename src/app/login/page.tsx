import Link from "next/link";
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
          {/* アプリの正体はmbPIT（2026-08-28 ブランド一本化）。
              mbFASTの名前はECU案件の業務画面の中でだけ出す */}
          <div className="mb-2 inline-flex items-center gap-2">
            <span className="text-2xl font-black tracking-tight text-ink">
              mb<span className="text-gold-500">PIT</span>
            </span>
          </div>
          <p className="text-sm text-ink-soft">記録が、集客と信頼に変わる。</p>
        </div>
        <LoginForm />
        {/* mbPIT加盟店は自己登録できる（公開ページ）。ログイン画面が入口になる */}
        <p className="mt-6 text-center text-xs">
          <Link
            href="/pit/join"
            className="font-semibold text-gold-600 hover:underline"
          >
            mbPIT加盟店の新規登録はこちら →
          </Link>
        </p>
      </div>
    </main>
  );
}
