"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { reidentifyMissingCalAi } from "@/lib/actions/catalog";

// Cal 未設定の純正をまとめてAI判定（原本ありのみ・件数上限つき＝コスト対策）。
export function BulkReidentifyButton() {
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const router = useRouter();

  const run = () => {
    if (!window.confirm("Cal未設定の純正を最大20件、AIで一括判定します。よろしいですか？")) return;
    setMsg(null);
    start(async () => {
      const r = await reidentifyMissingCalAi(20);
      if (r.error) setMsg({ ok: false, text: r.error });
      else {
        setMsg({ ok: true, text: `${r.scanned}件中 ${r.updated}件にCalを設定しました。` });
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
        className="inline-flex items-center gap-1 rounded-lg border border-sky-300 bg-sky-50 px-3 py-1.5 text-sm font-semibold text-sky-700 hover:bg-sky-100 disabled:opacity-50"
      >
        {pending ? "AI一括判定中…" : "🤖 Cal未設定をAIで一括判定（最大20件）"}
      </button>
      {msg && (
        <span className={`text-xs font-semibold ${msg.ok ? "text-sky-700" : "text-red-600"}`}>
          {msg.text}
        </span>
      )}
    </div>
  );
}
