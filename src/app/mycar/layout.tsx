import type { ReactNode } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "mbPIT — クルマのお薬手帳",
  description: "車検証のQRで、あなたの車の施工履歴と施工証明を確認できます。",
  robots: { index: false }, // ステルス運用（URLを知る人だけ）
};

// 顧客向けページはmbPITブランド（ダーク×ゴールド）。アプリのAppShellは使わない
export default function MycarLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-dvh w-full bg-[#0F1218] text-[#EDF1F7]">
      <div className="mx-auto max-w-[480px] px-4 pb-16">
        <header className="flex items-center justify-between py-4">
          <div>
            <span className="text-xl font-black tracking-wide">
              mb<span className="text-[#E53935]">PIT</span>
            </span>
            <span className="block text-[9px] font-semibold tracking-[2px] text-[#8B97A8]">
              クルマのお薬手帳
            </span>
          </div>
          <span className="rounded-full border border-[#2A3342] px-3 py-1 text-[9px] tracking-wider text-[#8B97A8]">
            OWNER
          </span>
        </header>
        {children}
      </div>
    </div>
  );
}
