"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setRecordDealer } from "@/lib/actions/records";

// 施工代理店をプルダウンで変更（本店のみ）
export function RecordDealerSelect({
  recordId,
  currentDealerId,
  dealers,
}: {
  recordId: string;
  currentDealerId: string;
  dealers: { id: string; name: string }[];
}) {
  const [value, setValue] = useState(currentDealerId);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const router = useRouter();

  const onChange = (next: string) => {
    setValue(next);
    setError(null);
    setSaved(false);
    start(async () => {
      const r = await setRecordDealer(recordId, next);
      if (r.error) {
        setError(r.error);
        setValue(currentDealerId);
      } else {
        setSaved(true);
        router.refresh();
      }
    });
  };

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <select
        value={value}
        disabled={pending}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg border border-line bg-surface px-2 py-1 text-sm font-medium disabled:opacity-50"
      >
        {dealers.map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </select>
      {pending && <span className="text-xs text-ink-soft">変更中…</span>}
      {saved && !pending && <span className="text-xs font-semibold text-green-700">変更しました</span>}
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
