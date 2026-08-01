import type { ReactNode } from "react";
import Link from "next/link";
import { logout } from "@/lib/actions/auth";
import { roleLabels } from "@/lib/labels";
import { NavBar, type NavItem } from "@/components/nav-bar";
import { BottomNav, type BottomNavItem } from "@/components/bottom-nav";
import { PushManager } from "@/components/push-manager";
import type { SessionUser } from "@/lib/authz";

export function AppShell({
  user,
  navItems,
  bottomNavItems,
  brand = "mbfast",
  children,
}: {
  user: SessionUser;
  navItems: NavItem[];
  // 指定するとスマホでは下タブバーに切り替わる（上部ナビはsm以上のみ表示）
  bottomNavItems?: BottomNavItem[];
  // mbpit: mbPIT専用アカウント向け表示（mbFASTブランドを出さない・別ブランド運用）
  brand?: "mbfast" | "mbpit";
  children: ReactNode;
}) {
  const hasBottomNav = !!bottomNavItems && bottomNavItems.length > 0;
  const isPit = brand === "mbpit";
  return (
    // overflow-x-clip: どれか1要素が幅を突き破ってもページ全体が横スクロールにならない保険
    // （clipはhiddenと違いstickyナビを壊さない。表などは各自のoverflow-x-autoで横スクロール可能なまま）
    <div
      className={`flex min-h-dvh flex-col ${hasBottomNav ? "overflow-x-clip" : ""} ${
        isPit ? "mbpit-theme" : ""
      }`}
    >
      {/* ヘッダー: mbPITは群青×ゴールドで常時固定。mbFASTは下タブ使用時のみスマホで固定 */}
      {/* no-print: アプリのヘッダーは紙に出さない（証明書だけが紙に出るようにする） */}
      <header
        className={
          isPit
            ? // HPのmbPIT記事トップバーと同じ見た目（黒地＋ゴールドの下線）
              "no-print sticky top-0 z-30 border-b-2 border-gold-500 bg-[#0d0d0d]"
            : `no-print border-b border-line bg-surface ${hasBottomNav ? "max-sm:sticky max-sm:top-0 max-sm:z-30" : ""}`
        }
      >
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-2.5">
          <div className="flex items-baseline gap-2">
            <span className={`text-lg font-black tracking-tight ${isPit ? "text-white" : "text-ink"}`}>
              {isPit ? (
                <>
                  mb<span className="text-gold-300">PIT</span>
                </>
              ) : (
                <>
                  mb<span className="text-gold-500">FAST</span>
                </>
              )}
            </span>
            <span
              className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${
                isPit ? "bg-white/10 text-white/80" : "bg-surface-2 text-ink-soft"
              }`}
            >
              {isPit ? "加盟店" : roleLabels[user.role]}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className={`hidden text-sm sm:inline ${isPit ? "text-white/80" : "text-ink-soft"}`}>
              {user.name}
            </span>
            <Link
              href="/account"
              className={`rounded-lg px-2 py-1 text-sm transition ${
                isPit ? "text-white/80 hover:bg-white/10" : "text-ink-soft hover:bg-surface-2"
              }`}
            >
              パスワード変更
            </Link>
            <form action={logout}>
              <button
                type="submit"
                className={`rounded-lg px-2 py-1 text-sm transition ${
                  isPit ? "text-white/80 hover:bg-white/10" : "text-ink-soft hover:bg-surface-2"
                }`}
              >
                ログアウト
              </button>
            </form>
          </div>
        </div>
      </header>

      {navItems.length > 0 && (
        <NavBar items={navItems} className={hasBottomNav ? "hidden sm:block" : undefined} />
      )}

      {/* break-words: 長いURL・VIN・ファイル名などの折り返し不能文字列が幅を押し広げるのを防ぐ */}
      <main
        className={`mx-auto w-full max-w-5xl flex-1 break-words px-4 py-5 ${hasBottomNav ? "pb-24 sm:pb-5" : ""}`}
      >
        {children}
      </main>

      {/* Web Push 購読管理（通知許可済みなら自動購読） */}
      <PushManager raised={hasBottomNav} />

      {hasBottomNav && <BottomNav items={bottomNavItems} dark={isPit} />}
    </div>
  );
}
