"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateBaseFile } from "@/lib/actions/catalog";

// 記録ページのECU識別子カードから、照合先純正(BaseFile)の Driver を入力・修正する。
// カタログと同じデータなので、どちらから直しても同じ（本店のみ・代理店には出さない）。
export function BaseDriverEdit({
  baseFileId,
  driver,
  driverBorrowed,
}: {
  baseFileId: string;
  driver: string;
  driverBorrowed: boolean;
}) {
  const [v, setV] = useState(driver);
  const [borrowed, setBorrowed] = useState(driverBorrowed);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const router = useRouter();

  const save = (patch: Record<string, unknown>) =>
    start(async () => {
      setSaved(false);
      await updateBaseFile(baseFileId, patch);
      setSaved(true);
      router.refresh();
    });

  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span
        className="font-semibold text-ink-soft"
        title="ECM Titanium 等の使用Driver（本店のみ・カタログにも反映）"
      >
        Driver
      </span>
      {borrowed && v && <span className="text-ink-soft">(</span>}
      <input
        value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => {
          if (v.trim() !== driver) save({ driver: v.trim() });
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        placeholder="Driver名"
        className="w-44 rounded border border-line bg-surface px-2 py-1 font-mono text-xs"
      />
      {borrowed && v && <span className="text-ink-soft">)</span>}
      <label
        className="inline-flex items-center gap-1 text-ink-soft"
        title="他のDriverを流用（名前を()で表示）"
      >
        <input
          type="checkbox"
          checked={borrowed}
          disabled={pending}
          onChange={(e) => {
            setBorrowed(e.target.checked);
            save({ driverBorrowed: e.target.checked });
          }}
          className="h-3.5 w-3.5 accent-gold-500"
        />
        流用
      </label>
      {saved && !pending && <span className="font-semibold text-green-700">保存しました（カタログにも反映）</span>}
    </div>
  );
}
