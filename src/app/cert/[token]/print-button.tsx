"use client";

// 共有ページの印刷ボタン（PDF保存はブラウザの印刷ダイアログから行う）
export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="shrink-0 rounded-lg bg-neutral-900 px-3 py-2 text-xs font-bold text-white"
    >
      印刷 / PDF
    </button>
  );
}
