"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string };

export function NavBar({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-10 border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex max-w-5xl gap-1 overflow-x-auto px-2 py-1.5">
        {items.map((item) => {
          // 完全一致 or 配下パスでアクティブ判定（ホームは完全一致のみ）
          const isHome = item.href.split("/").length <= 2;
          const active = isHome
            ? pathname === item.href
            : pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition ${
                active
                  ? "bg-gold-100 text-gold-700"
                  : "text-ink-soft hover:bg-surface-2"
              }`}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
