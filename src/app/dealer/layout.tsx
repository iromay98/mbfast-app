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
      ? {
          href: "/dealer/pit",
          label: "ブログ投稿",
          icon: "mic",
          also: ["/dealer/pit/customers", "/dealer/pit/vehicles", "/dealer/pit/certificates", "/dealer/pit/gbp"],
        }
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
  // mbPIT専用アカウント（外部店舗）: mbFASTブランド・ECU系メニューを一切出さない（別ブランド運用）。
  // 群青×ゴールドの専用シェル＋下タブ4つ（ホーム/投稿/顧客/店舗）
  if (dealer?.pitOnly) {
    const pitTabs: BottomNavItem[] = [
      { href: "/dealer/pit/home", label: "ホーム", icon: "home" },
      { href: "/dealer/pit", label: "投稿", icon: "mic", exact: true },
      // 車両登録・証明書は顧客カルテと同じ枠（タブは4つに保つ）
      {
        href: "/dealer/pit/customers",
        label: "顧客",
        icon: "user",
        also: ["/dealer/pit/vehicles", "/dealer/pit/certificates"],
      },
      { href: "/dealer/pit/store", label: "店舗", icon: "shop", also: ["/dealer/pit/gbp"] },
    ];
    const pitNav: NavItem[] = [
      { href: "/dealer/pit/home", label: "ホーム" },
      { href: "/dealer/pit", label: "投稿" },
      { href: "/dealer/pit/customers", label: "顧客カルテ" },
      { href: "/dealer/pit/vehicles", label: "車両登録" },
      { href: "/dealer/pit/certificates", label: "施工証明書" },
      { href: "/dealer/pit/gbp", label: "Googleマップ連携" },
      { href: "/dealer/pit/store", label: "店舗情報" },
    ];
    return (
      <AppShell user={user} navItems={pitNav} bottomNavItems={pitTabs} brand="mbpit">
        {children}
      </AppShell>
    );
  }
  // 本部が許可した（＝PitStoreが有効な）代理店には、mbPITの顧客カルテ・車両・施工証明書・
  // ブログ投稿・Googleマップ連携の導線をまとめて出す。ページ自体は pitOnly を前提にしておらず、
  // これまでは導線だけが未配線だった。
  const pitDealerNav: NavItem[] = [
    { href: "/dealer/pit", label: "施工ブログ投稿" },
    { href: "/dealer/pit/customers", label: "顧客カルテ" },
    { href: "/dealer/pit/vehicles", label: "車両登録" },
    { href: "/dealer/pit/certificates", label: "施工証明書" },
    { href: "/dealer/pit/gbp", label: "Googleマップ連携" },
  ];
  const navItems: NavItem[] = pitStore?.active
    ? [...dealerNav.slice(0, 2), ...pitDealerNav, ...dealerNav.slice(2)]
    : dealerNav;
  return (
    <AppShell user={user} navItems={navItems} bottomNavItems={dealerBottomNav(!!pitStore?.active)}>
      {children}
    </AppShell>
  );
}
