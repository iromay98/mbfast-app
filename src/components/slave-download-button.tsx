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
  onDone,
  hideBar = false,
}: {
  href: string;
  label: string;
  className?: string;
  fallbackName?: string | null;
  // DL完了後に呼ぶ（DL済み表示の更新など）
  onDone?: () => void;
  // 進捗バーを出さない（横1列に収めたい場所用。％はボタン内に出る）
  hideBar?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [pct, setPct] = useState<number | null>(null); // 受信進捗（Content-Length があるとき）
  const [error, setError] = useState<string | null>(null);

  const onClick = async () => {
    if (busy) return;
    setError(null);
    setBusy(true);
    setPct(null);
    try {
      const res = await fetch(href);
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(txt || `ダウンロードに失敗しました (${res.status})`);
      }
      // 進捗表示: Content-Length があればストリームで受信量を数える
      const total = Number(res.headers.get("content-length") ?? 0);
      let blob: Blob;
      if (total > 0 && res.body) {
        const reader = res.body.getReader();
        const chunks: Uint8Array[] = [];
        let received = 0;
        setPct(0);
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) {
            chunks.push(value);
            received += value.byteLength;
            setPct(Math.min(99, Math.round((received / total) * 100)));
          }
        }
        setPct(100);
        blob = new Blob(chunks as BlobPart[]);
      } else {
        blob = await res.blob();
      }
      const name =
        filenameFromDisposition(res.headers.get("content-disposition")) ??
        fallbackName ??
        "download.slave";
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(objUrl), 10000);
      onDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "ダウンロードに失敗しました");
    } finally {
      setBusy(false);
      setPct(null);
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
            {pct == null ? "準備中…" : `受信中 ${pct}%`}
          </span>
        ) : (
          label
        )}
      </button>
      {/* 進捗バー: 数値が取れれば実測、取れない間（暗号化待ち等）は不定アニメーション */}
      {busy && !hideBar && <ProgressBar pct={pct} />}
      {error && <span className="text-xs text-red-600">{error}（再度お試しください）</span>}
    </span>
  );
}

// 進捗バー（pct=null は不定＝流れるアニメーション）
export function ProgressBar({ pct }: { pct: number | null }) {
  return (
    <span className="block h-1.5 w-full min-w-[9rem] overflow-hidden rounded-full bg-black/10">
      {pct == null ? (
        <span className="block h-full w-1/3 animate-[indeterminate_1.2s_ease-in-out_infinite] rounded-full bg-gold-500" />
      ) : (
        <span
          className="block h-full rounded-full bg-gold-500 transition-[width] duration-150"
          style={{ width: `${pct}%` }}
        />
      )}
    </span>
  );
}
