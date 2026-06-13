"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { restoreRecord, purgeRecord } from "@/lib/actions/records";
import { restoreVariant, purgeVariant } from "@/lib/actions/catalog";

export type ArchivedRecord = { id: string; title: string; sub: string };
export type ArchivedVariant = { id: string; title: string; sub: string };

function Row({
  title,
  sub,
  onRestore,
  onPurge,
}: {
  title: string;
  sub: string;
  onRestore: () => Promise<{ error?: string }>;
  onPurge: () => Promise<{ error?: string }>;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const run = (fn: () => Promise<{ error?: string }>, confirmMsg?: string) => {
    if (confirmMsg && !window.confirm(confirmMsg)) return;
    setError(null);
    start(async () => {
      const r = await fn();
      if (r?.error) setError(r.error);
      else router.refresh();
    });
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-ink">{title}</div>
        <div className="truncate text-xs text-ink-soft">{sub}</div>
        {error && <div className="text-xs text-red-600">{error}</div>}
      </div>
      <div className="flex shrink-0 gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() => run(onRestore)}
          className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-surface-2 disabled:opacity-50"
        >
          {pending ? "…" : "復元"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            run(onPurge, "完全に削除します。元に戻せません。よろしいですか？")
          }
          className="rounded-lg border border-red-200 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
        >
          完全削除
        </button>
      </div>
    </div>
  );
}

export function ArchivePanel({
  records,
  variants,
}: {
  records: ArchivedRecord[];
  variants: ArchivedVariant[];
}) {
  return (
    <div className="space-y-4">
      <div>
        <h4 className="mb-1 text-xs font-bold text-ink-soft">施工記録（{records.length}）</h4>
        {records.length === 0 ? (
          <p className="text-xs text-ink-soft">アーカイブされた施工記録はありません。</p>
        ) : (
          <div className="divide-y divide-line rounded-lg border border-line">
            {records.map((r) => (
              <Row
                key={r.id}
                title={r.title}
                sub={r.sub}
                onRestore={() => restoreRecord(r.id)}
                onPurge={() => purgeRecord(r.id)}
              />
            ))}
          </div>
        )}
      </div>

      <div>
        <h4 className="mb-1 text-xs font-bold text-ink-soft">カタログの版（{variants.length}）</h4>
        {variants.length === 0 ? (
          <p className="text-xs text-ink-soft">アーカイブされた版はありません。</p>
        ) : (
          <div className="divide-y divide-line rounded-lg border border-line">
            {variants.map((v) => (
              <Row
                key={v.id}
                title={v.title}
                sub={v.sub}
                onRestore={() => restoreVariant(v.id)}
                onPurge={() => purgeVariant(v.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
