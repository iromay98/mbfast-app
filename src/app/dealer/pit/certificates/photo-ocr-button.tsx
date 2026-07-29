"use client";

import { useRef, useState } from "react";

/*
 * 写真から値を読み取るボタン（証明書入力の主導線）。
 * 読み取った値はそのまま保存せずフォームに入れるだけ。店舗が確認・修正して確定する。
 * 読めなかった項目は空のままにして、手入力で続けられるようにする。
 */
export function PhotoOcrButton({
  target,
  label,
  disabled,
  onValues,
}: {
  target: string;
  label: string;
  disabled?: boolean;
  onValues: (values: Record<string, string>, notes: string[], warnings: string[]) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const read = async (file: File) => {
    setBusy(true);
    setError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("target", target);
      const res = await fetch("/api/pit/photo-ocr", { method: "POST", body: fd });
      const body = (await res.json()) as {
        error?: string;
        values?: Record<string, string>;
        notes?: string[];
        warnings?: string[];
      };
      if (!res.ok || !body.values) {
        setError(body.error ?? "読み取れませんでした。手入力で進めてください");
        return;
      }
      onValues(body.values, body.notes ?? [], body.warnings ?? []);
    } catch {
      setError("通信エラーが発生しました。手入力で進めてください");
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = "";
    }
  };

  return (
    <span className="inline-flex flex-col">
      <input
        ref={ref}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void read(f);
        }}
      />
      <button
        type="button"
        disabled={disabled || busy}
        onClick={() => ref.current?.click()}
        className="rounded-lg border border-gold-300 bg-surface px-3 py-2 text-xs font-bold text-ink disabled:opacity-50"
      >
        {busy ? "読み取り中…" : `📷 ${label}`}
      </button>
      {error && <span className="mt-1 text-[10px] font-semibold text-red-600">{error}</span>}
    </span>
  );
}
