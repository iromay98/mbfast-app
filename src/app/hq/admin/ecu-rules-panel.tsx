"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteEcuRule } from "@/lib/actions/admin";

export type RuleRow = {
  id: string;
  field: string; // HW/SW/CAL
  kind: string; // EXACT/MARKER
  summary: string;
};

export function EcuRulesPanel({ rules }: { rules: RuleRow[] }) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, start] = useTransition();
  const router = useRouter();

  const del = (id: string) => {
    if (!window.confirm("この学習ルールを削除しますか？")) return;
    setPendingId(id);
    start(async () => {
      await deleteEcuRule(id);
      setPendingId(null);
      router.refresh();
    });
  };

  if (rules.length === 0) {
    return (
      <p className="text-xs text-ink-soft">
        まだ学習はありません。純正や施工記録で HW/SW/Cal を手入力すると、ここに学習ルールが貯まります。
      </p>
    );
  }

  return (
    <div className="divide-y divide-line rounded-lg border border-line">
      {rules.map((r) => (
        <div key={r.id} className="flex items-center justify-between gap-3 px-3 py-2">
          <div className="min-w-0">
            <span
              className={`mr-2 rounded px-1.5 py-0.5 text-[11px] font-semibold ${
                r.kind === "EXACT"
                  ? "bg-green-50 text-green-700"
                  : "bg-gold-50 text-gold-700"
              }`}
            >
              {r.field === "CALVER" ? "Cal(版)" : r.field}・
              {r.kind === "EXACT" ? "完全一致" : "マーカー"}
            </span>
            <span className="text-xs text-ink-soft">{r.summary}</span>
          </div>
          <button
            type="button"
            disabled={pendingId === r.id}
            onClick={() => del(r.id)}
            className="shrink-0 rounded-lg border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            削除
          </button>
        </div>
      ))}
    </div>
  );
}
