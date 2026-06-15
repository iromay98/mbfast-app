"use client";

import { useEffect, useRef, useState } from "react";
import { getDownloadFee, type TuningSelection, type DownloadFee } from "@/lib/actions/requests";

type Phase = "idle" | "checking" | "consent" | "counting";

const COUNTDOWN_SEC = 10;

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
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const triggerDownload = () => {
    const a = document.createElement("a");
    a.href = href;
    a.download = "";
    document.body.appendChild(a);
    a.click();
    a.remove();
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
        triggerDownload();
        setPhase("idle");
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
        triggerDownload();
        setPhase("idle");
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
      <button
        type="button"
        onClick={onDownloadClick}
        className="inline-flex items-center rounded-lg bg-gold-500 px-4 py-2 text-sm font-semibold text-white"
      >
        DL可能 — .slave をダウンロード
      </button>
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
              triggerDownload();
              setPhase("idle");
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
