import type { ReactNode } from "react";
import { requireHQ } from "@/lib/authz";
import { AppShell } from "@/components/app-shell";
import type { NavItem } from "@/components/nav-bar";

const hqNav: NavItem[] = [
  // mbPITが主・mbFAST業務は従（2026-08-28 ブランド一本化）。
  // アプリ全体がmbPITなので、pit系のラベルから「mbPIT」接頭辞は外し、
  // 逆にmbFAST業務（ECU案件・価格表・車両ページ）側に名前を付ける
  { href: "/hq", label: "ダッシュボード" },
  { href: "/hq/pit", label: "加盟店・投稿" },
  { href: "/hq/pit/vehicles", label: "車両台帳" },
  { href: "/hq/pit/certificates", label: "施工証明書" },
  { href: "/hq/pit/gbp", label: "マップ投稿" },
  { href: "/hq/dealers", label: "代理店管理" },
  { href: "/hq/records", label: "mbFAST案件" },
  { href: "/hq/catalog", label: "カタログ" },
  { href: "/hq/showcase", label: "施工事例" },
  { href: "/hq/prices", label: "価格表(mbFAST)" },
  { href: "/hq/vehicle-pages", label: "車両ページ(mbFAST)" },
  { href: "/hq/activity", label: "ログ" },
  { href: "/hq/announcements", label: "お知らせ" },
  { href: "/hq/admin", label: "メンテナンス" },
];

export default async function HQLayout({ children }: { children: ReactNode }) {
  const user = await requireHQ(); // 本店管理者のみ
  return (
    <AppShell user={user} navItems={hqNav} badge="本部">
      {children}
    </AppShell>
  );
}
