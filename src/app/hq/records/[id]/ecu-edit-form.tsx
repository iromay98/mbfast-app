"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setRecordEcu } from "@/lib/actions/records";

// ECU識別子(HW/SW/Cal)の手動入力・修正（本店のみ）。
// 自動抽出に未対応の車種（ベンツ等）で本店が手で補える。
export function EcuEditForm({
  recordId,
  hw,
  sw,
  cal,
}: {
  recordId: string;
  hw: string | null;
  sw: string | null;
  cal: string | null;
}) {
  const [h, setH] = useState(hw ?? "");
  const [s, setS] = useState(sw ?? "");
  const [c, setC] = useState(cal ?? "");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const router = useRouter();

  const dirty = h !== (hw ?? "") || s !== (sw ?? "") || c !== (cal ?? "");

  const save = () => {
    if (!dirty) return;
    setError(null);
    setSaved(false);
    start(async () => {
      const r = await setRecordEcu(recordId, { hw: h, sw: s, cal: c });
      if (r.error) setError(r.error);
      else {
        setSaved(true);
        router.refresh();
      }
    });
  };

  const field = (
    label: string,
    val: string,
    set: (v: string) => void,
    ph: string,
  ) => (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-ink-soft">{label}</span>
      <input
        type="text"
        value={val}
        disabled={pending}
        placeholder={ph}
        onChange={(e) => {
          set(e.target.value);
          setSaved(false);
        }}
        className="w-full rounded-lg border border-line bg-surface px-2.5 py-1.5 font-mono text-sm disabled:opacity-50"
      />
    </label>
  );

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        {field("Cal番号", c, setC, "例: 8V0907404_0004")}
        {field("SW番号", s, setS, "例: A2769005800")}
        {field("HW番号", h, setH, "例: A2769003200")}
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={pending || !dirty}
          className="rounded-lg border border-line px-3 py-1.5 text-sm font-semibold text-ink-soft hover:bg-surface-2 disabled:opacity-40"
        >
          {pending ? "保存中…" : "保存"}
        </button>
        {saved && !pending && <span className="text-xs font-semibold text-green-700">保存しました</span>}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    </div>
  );
}
