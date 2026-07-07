"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteShowcase, setShowcaseVisibility } from "@/lib/actions/showcase";
import { normalizeEmbeds } from "@/lib/showcase/embed";

export type AdminRow = {
  id: string;
  title: string;
  vehicle: string;
  contentLabel: string | null;
  visibility: "PUBLIC" | "DEALER";
  embeds: unknown;
  publishedAtLabel: string;
};

export function ShowcaseAdmin({ rows }: { rows: AdminRow[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok?: true; error?: string }>) =>
    start(async () => {
      const r = await fn();
      setMsg(r?.error ?? null);
      router.refresh();
    });

  if (rows.length === 0) {
    return <p className="rounded-xl border border-line bg-surface p-6 text-center text-sm text-ink-soft">まだ事例がありません。施工記録の詳細から「事例化」できます。</p>;
  }

  return (
    <div className="space-y-2">
      {pending && <p className="text-xs text-ink-soft">保存中…</p>}
      {msg && <p className="text-xs text-red-600">{msg}</p>}
      {rows.map((r) => {
        const n = normalizeEmbeds(r.embeds).length;
        return (
          <div key={r.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-line bg-surface p-3">
            <span className="text-sm font-bold text-ink">{r.title}</span>
            <span className="text-xs text-ink-soft">{r.vehicle}</span>
            {r.contentLabel && (
              <span className="rounded bg-gold-50 px-1.5 py-0.5 text-[11px] font-semibold text-gold-700">
                {r.contentLabel}
              </span>
            )}
            <span className="text-[11px] text-ink-soft">埋め込み {n}</span>
            <span className="text-[11px] text-ink-soft">{r.publishedAtLabel}</span>
            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => setShowcaseVisibility(r.id, r.visibility === "PUBLIC" ? "DEALER" : "PUBLIC"))}
                className={`rounded px-2 py-1 text-[11px] font-bold ${
                  r.visibility === "PUBLIC" ? "bg-green-100 text-green-700" : "bg-sky-100 text-sky-700"
                }`}
                title="クリックで公開範囲を切替"
              >
                {r.visibility === "PUBLIC" ? "一般公開" : "代理店限定"}
              </button>
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (window.confirm(`「${r.title}」を削除します。よろしいですか？`)) run(() => deleteShowcase(r.id));
                }}
                className="rounded border border-red-200 px-2 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50"
              >
                削除
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
