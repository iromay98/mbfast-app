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

// スマホの下タブバー（HPと同じ4ボタン構成）。履歴は施工依頼ページ内に統合済み。
// 3枠目は mbPIT加盟店なら「ブログ投稿」、未加盟なら「施工事例」（動的に切替）
function dealerBottomNav(pitMember: boolean): BottomNavItem[] {
  return [
    {
      href: "/dealer",
      label: "Home",
      icon: "home",
      also: ["/dealer/announcements", ...(pitMember ? ["/dealer/showcase"] : [])],
    },
    {
      href: "/dealer/records",
      label: "施工依頼",
      icon: "wrench",
      also: ["/dealer/requests", "/dealer/activity"],
    },
    pitMember
      ? { href: "/dealer/pit", label: "ブログ投稿", icon: "mic" }
      : { href: "/dealer/showcase", label: "施工事例", icon: "camera" },
    { href: "/dealer/prices", label: "価格表", icon: "yen" },
  ];
}

export default async function DealerLayout({
  children,
}: {
  children: ReactNode;
}) {
  const user = await requireDealer(); // 代理店のみ
  // mbPIT加盟店（店舗マスタ登録済み・有効）だけに投稿メニューを出す
  const [pitStore, dealer] = await Promise.all([
    prisma.pitStore.findUnique({
      where: { dealerId: user.dealerId },
      select: { active: true },
    }),
    prisma.dealer.findUnique({
      where: { id: user.dealerId },
      select: { pitOnly: true },
    }),
  ]);
  // mbPIT専用アカウント（外部店舗）はブログ投稿のみ。ECU系メニューは出さない
  if (dealer?.pitOnly) {
    const pitNav: NavItem[] = [{ href: "/dealer/pit", label: "施工ブログ投稿" }];
    return (
      <AppShell
        user={user}
        navItems={pitNav}
        bottomNavItems={[{ href: "/dealer/pit", label: "ブログ投稿", icon: "mic" }]}
      >
        {children}
      </AppShell>
    );
  }
  const navItems: NavItem[] = pitStore?.active
    ? [...dealerNav.slice(0, 2), { href: "/dealer/pit", label: "施工ブログ投稿" }, ...dealerNav.slice(2)]
    : dealerNav;
  return (
    <AppShell user={user} navItems={navItems} bottomNavItems={dealerBottomNav(!!pitStore?.active)}>
      {children}
    </AppShell>
  );
}
