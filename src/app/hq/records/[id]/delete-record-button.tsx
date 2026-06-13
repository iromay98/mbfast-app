"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { deleteRecord } from "@/lib/actions/records";

// 施工記録の削除（本店のみ）。確認のうえ削除して一覧へ戻る。
export function DeleteRecordButton({ recordId, label }: { recordId: string; label: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const onDelete = () => {
    if (!window.confirm(`「${label}」の施工記録をアーカイブします（メンテナンスから復元できます）。よろしいですか？`)) return;
    start(async () => {
      setError(null);
      const r = await deleteRecord(recordId);
      if (r.error) setError(r.error);
      else router.push("/hq/records");
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={onDelete}
        disabled={pending}
        className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
      >
        {pending ? "削除中…" : "この施工記録を削除"}
      </button>
      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
