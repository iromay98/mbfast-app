import type { ReactNode } from "react";
import { requireHQ } from "@/lib/authz";
import { AppShell } from "@/components/app-shell";
import type { NavItem } from "@/components/nav-bar";

const hqNav: NavItem[] = [
  { href: "/hq", label: "ダッシュボード" },
  { href: "/hq/dealers", label: "代理店管理" },
  { href: "/hq/records", label: "施工記録・依頼" },
  { href: "/hq/catalog", label: "カタログ" },
  { href: "/hq/showcase", label: "施工事例" },
  { href: "/hq/activity", label: "ログ" },
  { href: "/hq/announcements", label: "お知らせ" },
  { href: "/hq/admin", label: "メンテナンス" },
];

export default async function HQLayout({ children }: { children: ReactNode }) {
  const user = await requireHQ(); // 本店管理者のみ
  return (
    <AppShell user={user} navItems={hqNav}>
      {children}
    </AppShell>
  );
}
