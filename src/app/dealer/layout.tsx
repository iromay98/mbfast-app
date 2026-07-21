import type { ReactNode } from "react";
import { requireDealer } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import type { NavItem } from "@/components/nav-bar";

const dealerNav: NavItem[] = [
  { href: "/dealer", label: "ダッシュボード" },
  { href: "/dealer/records", label: "施工記録・依頼" },
  { href: "/dealer/showcase", label: "施工事例" },
  { href: "/dealer/activity", label: "DL・依頼履歴" },
  { href: "/dealer/announcements", label: "お知らせ" },
];

export default async function DealerLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireDealer(); // 代理店のみ
  // mbPIT加盟店（店舗マスタ登録済み・有効）だけに投稿メニューを出す
  const pitStore = await prisma.pitStore.findUnique({
    where: { dealerId: user.dealerId },
    select: { active: true },
  });
  const navItems: NavItem[] = pitStore?.active
    ? [...dealerNav.slice(0, 2), { href: "/dealer/pit", label: "施工ブログ投稿" }, ...dealerNav.slice(2)]
    : dealerNav;
  return (
    <AppShell user={user} navItems={navItems}>
      {children}
    </AppShell>
  );
}
