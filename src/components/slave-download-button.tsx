"use client";

import { useState } from "react";

// Content-Disposition からダウンロード名を取り出す（RFC5987 の filename* を優先）。
function filenameFromDisposition(cd: string | null): string | null {
  if (!cd) return null;
  const star = cd.match(/filename\*=UTF-8''([^;]+)/i);
  if (star) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      /* フォールバックへ */
    }
  }
  const plain = cd.match(/filename="?([^";]+)"?/i);
  return plain ? plain[1] : null;
}

// .slave 等のダウンロードボタン。初回は本部APIで再暗号化され数秒かかるため、
// その間「準備中…」を表示し、完了(=バイト受信)して初めて保存する。失敗時は明示する。
export function SlaveDownloadButton({
  href,
  label,
  className,
  fallbackName = "download.slave",
}: {
  href: string;
  label: string;
  className?: string;
  fallbackName?: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(href);
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(txt || `ダウンロードに失敗しました (${res.status})`);
      }
      const blob = await res.blob();
      const name =
        filenameFromDisposition(res.headers.get("content-disposition")) ?? fallbackName;
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objUrl), 10000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "ダウンロードに失敗しました");
    } finally {
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        className={className}
        aria-busy={busy}
      >
        {busy ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-t-transparent opacity-70" />
            準備中…
          </span>
        ) : (
          label
        )}
      </button>
      {error && <span className="text-xs text-red-600">{error}（再度お試しください）</span>}
    </span>
  );
}
