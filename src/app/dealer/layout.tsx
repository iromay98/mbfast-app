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

// 本部が許可した代理店（PitStore有効）の下タブ。投稿を主役にし、料金表はホームへ移して
// 空いた枠を「顧客」に当てる（他の加盟店と同じ構成）。ECU業務ありなら4枠目を「施工依頼」に、
// なければ「店舗」にする（コーティング等の別業種向け）。
function ecuDealerBottomNav(ecuEnabled: boolean): BottomNavItem[] {
  return [
    { href: "/dealer", label: "ホーム", icon: "home", also: ["/dealer/announcements", "/dealer/prices"] },
    { href: "/dealer/pit", label: "投稿", icon: "mic", exact: true },
    {
      href: "/dealer/pit/customers",
      label: "顧客",
      icon: "user",
      also: ["/dealer/pit/vehicles", "/dealer/pit/certificates", "/dealer/pit/gbp"],
    },
    ecuEnabled
      ? {
          href: "/dealer/records",
          label: "施工依頼",
          icon: "wrench",
          also: ["/dealer/requests", "/dealer/activity"],
        }
      : { href: "/dealer/pit/store", label: "店舗", icon: "shop" },
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
      select: { pitOnly: true, ecuEnabled: true },
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
  // 本部が許可した（＝PitStoreが有効な）代理店は、投稿機能を主役にした構成にする。
  // 顧客カルテ・車両・施工証明書・ブログ・Map・店舗情報をまとめて出す（ページ自体は
  // pitOnly を前提にしていない）。ECU業務ありなら施工記録・依頼(ECUの特殊機能)も出す。
  const ecuEnabled = dealer?.ecuEnabled !== false; // 既定 true（既存の代理店はON）
  const pitDealerNav: NavItem[] = [
    { href: "/dealer/pit", label: "施工ブログ投稿" },
    { href: "/dealer/pit/customers", label: "顧客カルテ" },
    { href: "/dealer/pit/vehicles", label: "車両登録" },
    { href: "/dealer/pit/certificates", label: "施工証明書" },
    { href: "/dealer/pit/gbp", label: "Googleマップ連携" },
    { href: "/dealer/pit/store", label: "店舗情報" },
  ];

  if (pitStore?.active) {
    // ECUの特殊機能（施工記録・依頼／DL履歴）は ecuEnabled のときだけ
    const ecuNav: NavItem[] = ecuEnabled
      ? [
          { href: "/dealer/records", label: "施工記録・依頼" },
          { href: "/dealer/activity", label: "DL・依頼履歴" },
        ]
      : [];
    const navItems: NavItem[] = [
      { href: "/dealer", label: "ダッシュボード" },
      ...ecuNav,
      ...pitDealerNav,
      { href: "/dealer/showcase", label: "施工事例" },
      { href: "/dealer/prices", label: "価格表" },
      { href: "/dealer/announcements", label: "お知らせ" },
    ];
    return (
      <AppShell user={user} navItems={navItems} bottomNavItems={ecuDealerBottomNav(ecuEnabled)}>
        {children}
      </AppShell>
    );
  }

  // mbPIT未有効の代理店は従来どおり
  return (
    <AppShell user={user} navItems={dealerNav} bottomNavItems={dealerBottomNav(false)}>
      {children}
    </AppShell>
  );
}
