import { redirect } from "next/navigation";
import Link from "next/link";
import { getSessionUser } from "@/lib/authz";
import { PageTitle } from "@/components/ui";
import { ChangePasswordForm } from "./change-password-form";

export default async function AccountPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const home = user.role === "HQ_ADMIN" ? "/hq" : "/dealer";

  return (
    <div className="mx-auto w-full max-w-md px-4 py-8">
      <PageTitle title="パスワード変更" subtitle={user.name ?? undefined} />
      <div className="mb-3">
        <Link href={home} className="text-sm font-semibold text-gold-700 hover:underline">
          ← 戻る
        </Link>
      </div>
      <ChangePasswordForm />
      <p className="mt-3 text-xs text-ink-soft">
        変更後のパスワードは本部からも分かりません。忘れた場合は本部に連絡して再発行してください。
      </p>
    </div>
  );
}
