"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  previewReextractEcu,
  applyReextractEcu,
  type ReextractResult,
} from "@/lib/actions/admin";

function Diff({ label, before, after }: { label: string; before: string | null; after: string }) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-10 shrink-0 font-semibold text-ink-soft">{label}</span>
      <span className="font-mono text-ink-soft line-through">{before ?? "（無し）"}</span>
      <span className="text-ink-soft">→</span>
      <span className="font-mono font-semibold text-green-700">{after}</span>
    </div>
  );
}

export function ReextractPanel() {
  const [result, setResult] = useState<ReextractResult | null>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const run = (apply: boolean) =>
    start(async () => {
      setError(null);
      try {
        const r = apply ? await applyReextractEcu() : await previewReextractEcu();
        setResult(r);
        if (apply) router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => run(false)}
          disabled={pending}
          className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-ink-soft hover:bg-surface-2 disabled:opacity-50"
        >
          {pending ? "実行中…" : "プレビュー（変更点を確認）"}
        </button>
        <button
          type="button"
          onClick={() => run(true)}
          disabled={pending || !result || result.changed === 0}
          className="rounded-lg bg-gold-500 px-3 py-1.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          適用する
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {result && (
        <div className="space-y-2">
          <p className="text-sm text-ink">
            {result.applied ? "✅ 適用しました。" : "プレビュー結果："}
            復号bin {result.scanned} 件中、<b>{result.changed}</b> 件に変更
            {result.skipped > 0 ? `（${result.skipped} 件はbin読込不可でスキップ）` : ""}。
            {!result.applied && result.changed > 0 && "「適用する」で反映されます。"}
          </p>
          {result.items.length > 0 && (
            <div className="divide-y divide-line rounded-lg border border-line">
              {result.items.map((it) => (
                <div key={it.id} className="space-y-1 px-3 py-2">
                  <div className="text-sm font-medium text-ink">{it.label}</div>
                  {it.cal && <Diff label="Cal" before={it.cal.before} after={it.cal.after} />}
                  {it.sw && <Diff label="SW" before={it.sw.before} after={it.sw.after} />}
                  {it.hw && <Diff label="HW" before={it.hw.before} after={it.hw.after} />}
                </div>
              ))}
            </div>
          )}
          {result.changed === 0 && (
            <p className="text-sm text-ink-soft">変更はありませんでした（すべて最新の抽出結果と一致）。</p>
          )}
        </div>
      )}
    </div>
  );
}
