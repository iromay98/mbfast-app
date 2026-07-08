"use client";

import { useEffect, useRef, useState } from "react";
import { getDownloadFee, type TuningSelection, type DownloadFee } from "@/lib/actions/requests";

type Phase = "idle" | "checking" | "consent" | "counting" | "preparing";

const COUNTDOWN_SEC = 10;

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

// DLボタン → 課金種別を判定 → 有料なら忠告＋同意＋10秒キャンセル可能カウントダウン → 自動DL。
// 無料（当日のバブリング等）は即DL。
export function DownloadConsent({
  recordId,
  selection,
  href,
}: {
  recordId: string;
  selection: TuningSelection;
  href: string;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [fee, setFee] = useState<DownloadFee | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [remaining, setRemaining] = useState(COUNTDOWN_SEC);
  const [dlError, setDlError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // .slave は初回に本部APIで再暗号化されるため数秒かかることがある。
  // その間ずっと「準備中…」を出し、完了(=バイト受信)して初めて保存する。
  const triggerDownload = async () => {
    setDlError(null);
    setPhase("preparing");
    try {
      const res = await fetch(href);
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(txt || `ダウンロードに失敗しました (${res.status})`);
      }
      const blob = await res.blob();
      const name =
        filenameFromDisposition(res.headers.get("content-disposition")) ?? "download.slave";
      const objUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = objUrl;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // すぐに revoke するとダウンロードが始まらない場合があるため少し待つ。
      setTimeout(() => URL.revokeObjectURL(objUrl), 10000);
      setPhase("idle");
    } catch (e) {
      setDlError(e instanceof Error ? e.message : "ダウンロードに失敗しました");
      setPhase("idle");
    }
  };

  const clearTimer = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(() => () => clearTimer(), []);

  const onDownloadClick = async () => {
    setPhase("checking");
    setAgreed(false);
    try {
      const f = await getDownloadFee(recordId, selection);
      setFee(f);
      if (f.kind === "free") {
        await triggerDownload();
      } else {
        setPhase("consent");
      }
    } catch {
      setPhase("idle");
    }
  };

  const beginCountdown = () => {
    setRemaining(COUNTDOWN_SEC);
    setPhase("counting");
    const t0 = Date.now();
    clearTimer();
    timer.current = setInterval(() => {
      const rem = Math.max(0, COUNTDOWN_SEC - (Date.now() - t0) / 1000);
      setRemaining(rem);
      if (rem <= 0) {
        clearTimer();
        void triggerDownload();
      }
    }, 100);
  };

  const cancel = () => {
    clearTimer();
    setPhase("idle");
    setAgreed(false);
  };

  if (phase === "idle") {
    return (
      <div className="space-y-2">
        <button
          type="button"
          onClick={onDownloadClick}
          className="inline-flex items-center rounded-lg bg-gold-500 px-4 py-2 text-sm font-semibold text-white"
        >
          DL可能 — .slave をダウンロード
        </button>
        {dlError && (
          <p className="text-sm text-red-600">
            {dlError}（もう一度お試しください）
          </p>
        )}
      </div>
    );
  }

  if (phase === "checking") {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-soft">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-gold-300 border-t-gold-600" />
        確認中…
      </div>
    );
  }

  if (phase === "preparing") {
    return (
      <div className="flex items-center gap-2 text-sm text-ink-soft">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-gold-300 border-t-gold-600" />
        ダウンロードを準備中…（初回は数秒かかることがあります）
      </div>
    );
  }

  if (phase === "consent" && fee) {
    return (
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
        <p className="text-sm font-bold text-amber-800">⚠ {fee.label}が発生します</p>
        <p className="mt-1 text-xs text-amber-700">{fee.note}</p>
        <label className="mt-2 flex items-center gap-1.5 text-xs font-medium text-amber-900">
          <input
            type="checkbox"
            checked={agreed}
            onChange={(e) => setAgreed(e.target.checked)}
            className="h-4 w-4 accent-amber-600"
          />
          {fee.label}の発生に同意してダウンロードします
        </label>
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={!agreed}
            onClick={beginCountdown}
            className="rounded-lg bg-gold-500 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            同意してダウンロードへ
          </button>
          <button
            type="button"
            onClick={cancel}
            className="rounded-lg border border-line px-4 py-2 text-sm font-semibold text-ink-soft hover:bg-surface-2"
          >
            やめる
          </button>
        </div>
      </div>
    );
  }

  if (phase === "counting") {
    const pct = (remaining / COUNTDOWN_SEC) * 100;
    return (
      <div className="rounded-lg border border-gold-300 bg-white p-3">
        <p className="text-sm font-semibold text-ink">
          {Math.ceil(remaining)} 秒後に自動でダウンロードします
        </p>
        <p className="mt-0.5 text-xs text-ink-soft">中止する場合は下のキャンセルを押してください。</p>
        {/* アニメーションするカウントダウンバー */}
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-surface-2">
          <div
            className="h-full bg-gold-500"
            style={{ width: `${pct}%`, transition: "width 100ms linear" }}
          />
        </div>
        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={cancel}
            className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50"
          >
            キャンセル（{Math.ceil(remaining)}）
          </button>
          <button
            type="button"
            onClick={() => {
              clearTimer();
              void triggerDownload();
            }}
            className="text-xs font-semibold text-gold-700 hover:underline"
          >
            今すぐDL
          </button>
        </div>
      </div>
    );
  }

  return null;
}
