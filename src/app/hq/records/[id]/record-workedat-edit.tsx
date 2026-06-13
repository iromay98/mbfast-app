"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setRecordWorkedAt } from "@/lib/actions/records";

// 施工日をその場で変更（本店のみ）。current は YYYY-MM-DD。
export function RecordWorkedAtEdit({
  recordId,
  current,
}: {
  recordId: string;
  current: string;
}) {
  const [value, setValue] = useState(current);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const router = useRouter();

  const dirty = value !== current;

  const save = () => {
    if (!dirty || !value) return;
    setError(null);
    setSaved(false);
    start(async () => {
      const r = await setRecordWorkedAt(recordId, value);
      if (r.error) setError(r.error);
      else {
        setSaved(true);
        router.refresh();
      }
    });
  };

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <input
        type="date"
        value={value}
        disabled={pending}
        onChange={(e) => {
          setValue(e.target.value);
          setSaved(false);
        }}
        className="rounded-lg border border-line bg-surface px-2 py-1 text-sm disabled:opacity-50"
      />
      <button
        type="button"
        onClick={save}
        disabled={pending || !dirty || !value}
        className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-ink-soft hover:bg-surface-2 disabled:opacity-40"
      >
        {pending ? "…" : "保存"}
      </button>
      {saved && !pending && <span className="text-xs font-semibold text-green-700">保存しました</span>}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
