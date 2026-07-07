import type { ReactNode } from "react";

// 一般公開の施工事例レイアウト（未ログインでも閲覧可・アプリのchromeを出さない）。
export default function ShowcasePublicLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-surface-2">
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-5xl items-center gap-2 px-4 py-3">
          <span className="text-base font-extrabold tracking-tight text-ink">mbFAST</span>
          <span className="text-sm font-semibold text-ink-soft">施工事例</span>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
