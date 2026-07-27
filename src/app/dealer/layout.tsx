import type { ReactNode } from "react";
import { requireDealer } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { AppShell } from "@/components/app-shell";
import type { NavItem } from "@/components/nav-bar";
import type { BottomNavItem } from "@/components/bottom-nav";

const dealerNav: NavItem[] = [
  { href: "/dealer", label: "ダッシュボード" },
  { href: "/dealer/records", label: "施工記録・依頼" },
  { href: "/dealer/showcase", label: "施工事例" },
  { href: "/dealer/activity", label: "DL・依頼履歴" },
  { href: "/dealer/prices", label: "価格表" },
  { href: "/dealer/announcements", label: "お知らせ" },
];

// スマホの下タブバー（HPと同じ4ボタン構成）。お知らせ・施工事例・ブログ投稿はHome配下扱い
const dealerBottomNav: BottomNavItem[] = [
  {
    href: "/dealer",
    label: "Home",
    icon: "home",
    also: ["/dealer/announcements", "/dealer/showcase", "/dealer/pit"],
  },
  { href: "/dealer/records", label: "施工依頼", icon: "wrench", also: ["/dealer/requests"] },
  { href: "/dealer/activity", label: "履歴", icon: "history" },
  { href: "/dealer/prices", label: "価格表", icon: "yen" },
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
    <AppShell user={user} navItems={navItems} bottomNavItems={dealerBottomNav}>
      {children}
    </AppShell>
  );
}
