import type { ReactNode } from "react";
import Link from "next/link";
import { logout } from "@/lib/actions/auth";
import { roleLabels } from "@/lib/labels";
import { NavBar, type NavItem } from "@/components/nav-bar";
import { PushManager } from "@/components/push-manager";
import type { SessionUser } from "@/lib/authz";

export function AppShell({
  user,
  navItems,
  children,
}: {
  user: SessionUser;
  navItems: NavItem[];
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-2.5">
          <div className="flex items-baseline gap-2">
            <span className="text-lg font-black tracking-tight text-ink">
              mb<span className="text-gold-500">FAST</span>
            </span>
            <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[11px] font-medium text-ink-soft">
              {roleLabels[user.role]}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden text-sm text-ink-soft sm:inline">
              {user.name}
            </span>
            <Link
              href="/account"
              className="rounded-lg px-2 py-1 text-sm text-ink-soft transition hover:bg-surface-2"
            >
              パスワード変更
            </Link>
            <form action={logout}>
              <button
                type="submit"
                className="rounded-lg px-2 py-1 text-sm text-ink-soft transition hover:bg-surface-2"
              >
                ログアウト
              </button>
            </form>
          </div>
        </div>
      </header>

      <NavBar items={navItems} />

      <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-5">
        {children}
      </main>

      {/* Web Push 購読管理（通知許可済みなら自動購読） */}
      <PushManager />
    </div>
  );
}
