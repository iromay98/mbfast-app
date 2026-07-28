"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// スマホ用の下タブバー（mbFAST HPと同じ操作感）。sm以上では非表示＝従来の上部ナビを使う。
export type BottomNavItem = {
  href: string;
  label: string;
  icon: "home" | "wrench" | "history" | "yen" | "camera" | "mic" | "user" | "shop";
  // このタブをアクティブ扱いにする追加パス（例: Homeにお知らせ・施工事例を含める）
  also?: string[];
  // 完全一致のみアクティブ（例: /dealer/pit タブが /dealer/pit/* を拾わないように）
  exact?: boolean;
};

function Icon({ name }: { name: BottomNavItem["icon"] }) {
  const common = {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  switch (name) {
    case "home":
      return (
        <svg {...common}>
          <path d="M3 11.5 12 4l9 7.5" />
          <path d="M5.5 10v10h13V10" />
          <path d="M10 20v-5h4v5" />
        </svg>
      );
    case "wrench":
      return (
        <svg {...common}>
          <path d="M14.5 6.5a4.8 4.8 0 0 0-6.3 6.3L3.5 17.5V20.5h3l4.7-4.7a4.8 4.8 0 0 0 6.3-6.3l-3 3-2.3-2.3 3.3-3z" />
        </svg>
      );
    case "history":
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="8.5" />
          <path d="M12 7.5V12l3 2" />
        </svg>
      );
    case "yen":
      return (
        <svg {...common}>
          <path d="M7 4.5l5 7 5-7" />
          <path d="M12 11.5v8" />
          <path d="M8.5 13.5h7" />
          <path d="M8.5 16.5h7" />
        </svg>
      );
    case "camera":
      return (
        <svg {...common}>
          <path d="M4 8h3l2-2.5h6L17 8h3v11H4z" />
          <circle cx="12" cy="13" r="3.5" />
        </svg>
      );
    case "mic":
      return (
        <svg {...common}>
          <rect x="9" y="3.5" width="6" height="11" rx="3" />
          <path d="M5.5 11.5a6.5 6.5 0 0 0 13 0" />
          <path d="M12 18v2.5" />
        </svg>
      );
    case "user":
      return (
        <svg {...common}>
          <circle cx="12" cy="8" r="3.5" />
          <path d="M5 20a7 7 0 0 1 14 0" />
        </svg>
      );
    case "shop":
      return (
        <svg {...common}>
          <path d="M4 9.5 5.5 4h13L20 9.5" />
          <path d="M5 9.5V20h14V9.5" />
          <path d="M9.5 20v-6h5v6" />
        </svg>
      );
  }
}

export function BottomNav({ items, dark }: { items: BottomNavItem[]; dark?: boolean }) {
  const pathname = usePathname();

  return (
    <nav
      // iPhoneのホームバーと被らないよう safe-area 分＋最低10pxの余白を下に取る
      // dark: mbPIT加盟店向け（群青×ゴールド）
      className={`fixed inset-x-0 bottom-0 z-30 border-t pb-[max(env(safe-area-inset-bottom),10px)] backdrop-blur sm:hidden ${
        dark ? "border-gold-500/40 bg-[#1e3577]/95" : "border-line bg-surface/95"
      }`}
      aria-label="モバイルナビゲーション"
    >
      <div
        className="grid"
        style={{ gridTemplateColumns: `repeat(${items.length}, 1fr)` }}
      >
        {items.map((item) => {
          const isHome = item.href.split("/").length <= 2;
          const hit = (p: string) =>
            pathname === p || pathname.startsWith(p + "/");
          const active =
            (isHome || item.exact ? pathname === item.href : hit(item.href)) ||
            (item.also ?? []).some(hit);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-col items-center gap-0.5 py-2 text-[10px] font-semibold transition ${
                active
                  ? dark
                    ? "text-gold-300"
                    : "text-gold-600"
                  : dark
                    ? "text-white/60"
                    : "text-ink-soft"
              }`}
            >
              <Icon name={item.icon} />
              {item.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
