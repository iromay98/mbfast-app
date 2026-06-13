"use client";

import { useEffect } from "react";

// ルートのエラーバウンダリ。サーバ/クライアントの描画エラーで画面が固まった時、
// リロードせずに「再試行」で復帰できるようにする（戻らずリロード必要、の対策）。
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // 監査用にコンソールへ
    console.error("[route error]", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-md px-6 py-16 text-center">
      <h2 className="mb-2 text-lg font-bold text-ink">問題が発生しました</h2>
      <p className="mb-5 text-sm text-ink-soft">
        画面の読み込み中にエラーが起きました。下の「再試行」で復帰できます（多くの場合リロード不要です）。
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        <button
          type="button"
          onClick={() => reset()}
          className="rounded-lg bg-gold-500 px-4 py-2 text-sm font-semibold text-white"
        >
          再試行
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink-soft hover:bg-surface-2"
        >
          再読み込み
        </button>
      </div>
      {error.digest && (
        <p className="mt-4 font-mono text-xs text-ink-soft">参照ID: {error.digest}</p>
      )}
    </div>
  );
}
