"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  requestDownloadCancel,
  requestFileRequestCancel,
  resolveDownloadCancel,
  resolveRequestCancel,
} from "@/lib/actions/cancel";

// 代理店: 誤DL/誤リクエストのキャンセル依頼ボタン（理由つき）。
export function DealerCancelButton({
  kind,
  id,
}: {
  kind: "download" | "request";
  id: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const onClick = () => {
    const reason = window.prompt(
      kind === "download"
        ? "誤ダウンロードのキャンセルを本店へ依頼します。理由（任意）:"
        : "リクエストのキャンセルを本店へ依頼します。理由（任意）:",
    );
    if (reason === null) return; // キャンセル
    start(async () => {
      setError(null);
      const r =
        kind === "download"
          ? await requestDownloadCancel(id, reason)
          : await requestFileRequestCancel(id, reason);
      if (r.error) setError(r.error);
      router.refresh();
    });
  };

  return (
    <span className="inline-flex items-center gap-1">
      <button
        type="button"
        disabled={pending}
        onClick={onClick}
        title="間違えた場合は本店へキャンセルを依頼できます（本店の承諾で確定）"
        className="rounded border border-red-200 px-1.5 py-0.5 text-[11px] font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
      >
        {pending ? "…" : "キャンセル依頼"}
      </button>
      {error && <span className="text-[11px] text-red-600">{error}</span>}
    </span>
  );
}

// 本店: キャンセル依頼の承諾/却下ボタン。
export function HqCancelResolve({
  kind,
  id,
  reason,
}: {
  kind: "download" | "request";
  id: string;
  reason: string | null;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const resolve = (approve: boolean) => {
    if (
      !window.confirm(
        approve
          ? kind === "download"
            ? "このDLのキャンセルを承諾します（課金対象から除外）。よろしいですか？"
            : "このリクエストをキャンセルします。よろしいですか？"
          : "キャンセル依頼を却下します。よろしいですか？",
      )
    )
      return;
    start(async () => {
      setError(null);
      const r =
        kind === "download"
          ? await resolveDownloadCancel(id, approve)
          : await resolveRequestCancel(id, approve);
      if (r.error) setError(r.error);
      router.refresh();
    });
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-1" title={reason ? `理由: ${reason}` : undefined}>
      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-bold text-amber-800">
        キャンセル依頼中
      </span>
      <button
        type="button"
        disabled={pending}
        onClick={() => resolve(true)}
        className="rounded bg-green-600 px-1.5 py-0.5 text-[11px] font-bold text-white hover:bg-green-700 disabled:opacity-50"
      >
        承諾
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => resolve(false)}
        className="rounded border border-line px-1.5 py-0.5 text-[11px] font-semibold text-ink-soft hover:bg-surface-2 disabled:opacity-50"
      >
        却下
      </button>
      {error && <span className="text-[11px] text-red-600">{error}</span>}
    </span>
  );
}
