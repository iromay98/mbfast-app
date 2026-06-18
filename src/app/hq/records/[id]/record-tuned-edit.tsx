"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setRecordTuned } from "@/lib/actions/records";

// 純正/チューニング済みの切替（本店）。チューニング済みにすると ori 扱いを取り消し、
// 誤って自動取込した純正をカタログから外す。
export function RecordTunedEdit({ recordId, isTuned }: { recordId: string; isTuned: boolean }) {
  const [on, setOn] = useState(isTuned);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const router = useRouter();

  const toggle = (next: boolean) => {
    setOn(next);
    setSaved(false);
    start(async () => {
      await setRecordTuned(recordId, next);
      setSaved(true);
      router.refresh();
    });
  };

  return (
    <label className="flex items-start gap-2 text-sm text-ink">
      <input
        type="checkbox"
        checked={on}
        disabled={pending}
        onChange={(e) => toggle(e.target.checked)}
        className="mt-0.5 h-4 w-4 accent-gold-500"
      />
      <span>
        このファイルは<b>チューニング済み</b>（純正ではない）
        <span className="block text-xs text-ink-soft">
          チェックすると純正(ori)として扱わず、誤って取り込んだ純正はカタログから外します。
        </span>
        {saved && !pending && <span className="text-xs font-semibold text-green-700">保存しました</span>}
      </span>
    </label>
  );
}
