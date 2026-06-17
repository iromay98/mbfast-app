"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reidentifyEcuAi } from "@/lib/actions/records";

// 既存案件の保存済み復号binを、再復号せずにAIでCal再判定する（過去案件の遡り識別）。
export function ReidentifyEcuButton({ recordId }: { recordId: string }) {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();

  const run = () => {
    setMsg(null);
    start(async () => {
      const r = await reidentifyEcuAi(recordId);
      if (r.error) {
        setMsg({ ok: false, text: r.error });
      } else {
        const conf = r.confidence != null ? `（確信度${Math.round(r.confidence * 100)}%）` : "";
        setMsg({ ok: true, text: `AIが判定: Cal ${r.cal ?? "—"}${conf}` });
        router.refresh();
      }
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={run}
        disabled={pending}
        className="inline-flex items-center gap-1 rounded-lg border border-sky-300 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-100 disabled:opacity-50"
      >
        {pending ? "AI判定中…" : "🤖 AIでCalを再判定"}
      </button>
      {msg && (
        <span className={`text-xs font-semibold ${msg.ok ? "text-sky-700" : "text-red-600"}`}>
          {msg.text}
        </span>
      )}
    </div>
  );
}
