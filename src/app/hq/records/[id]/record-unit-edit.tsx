"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setRecordUnit } from "@/lib/actions/records";

// 対象ユニット(ECU/TCU)の切替（本店）。同時施工の取り違えに気づいたら後から直せる。
// 自動取込された純正(カタログ)側にも反映される。
export function RecordUnitEdit({ recordId, unit }: { recordId: string; unit: string }) {
  const [u, setU] = useState(unit === "TCU" ? "TCU" : "ECU");
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const router = useRouter();

  const pick = (next: "ECU" | "TCU") => {
    if (next === u) return;
    setU(next);
    setSaved(false);
    start(async () => {
      await setRecordUnit(recordId, next);
      setSaved(true);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs font-semibold text-ink-soft">対象ユニット</span>
      {(["ECU", "TCU"] as const).map((v) => (
        <button
          key={v}
          type="button"
          disabled={pending}
          onClick={() => pick(v)}
          className={`rounded-lg border px-3 py-1.5 text-sm font-bold ${
            u === v
              ? v === "TCU"
                ? "border-sky-500 bg-sky-500 text-white"
                : "border-gold-400 bg-gold-500 text-white"
              : "border-line bg-white text-ink-soft hover:bg-surface-2"
          }`}
        >
          {v === "ECU" ? "ECU（エンジン）" : "TCU（ミッション）"}
        </button>
      ))}
      {saved && !pending && (
        <span className="text-xs font-semibold text-green-700">保存しました（カタログにも反映）</span>
      )}
    </div>
  );
}
