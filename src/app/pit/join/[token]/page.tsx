import { redirect } from "next/navigation";

// 旧・招待リンク方式のURL。公開登録に一本化したため /pit/join へ寄せる
// （発行済みの招待URLを開いた店舗が迷子にならないための後方互換）。
export default function LegacyInvitePage() {
  redirect("/pit/join");
}
