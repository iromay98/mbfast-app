import type { ReactNode } from "react";
import { requireDealer } from "@/lib/authz";
import { AppShell } from "@/components/app-shell";
import type { NavItem } from "@/components/nav-bar";

const dealerNav: NavItem[] = [
  { href: "/dealer", label: "ダッシュボード" },
  { href: "/dealer/records", label: "施工記録・依頼" },
  { href: "/dealer/announcements", label: "お知らせ" },
];

export default async function DealerLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireDealer(); // 代理店のみ
  return (
    <AppShell user={user} navItems={dealerNav}>
      {children}
    </AppShell>
  );
}
