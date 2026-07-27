"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";

// ドラッグ&ドロップ対応のファイル選択ボックス。
// 中に通常の <input type="file"> を隠し持つので、フォーム送信・required 検証は従来どおり動く。
export function FileDropZone({
  name,
  required,
  accept,
}: {
  name: string;
  required?: boolean;
  accept?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<{ name: string; size: number } | null>(null);
  const [over, setOver] = useState(false);

  const sync = () => {
    const f = inputRef.current?.files?.[0];
    setFile(f ? { name: f.name, size: f.size } : null);
  };

  // form.reset()（アップロード成功時）で表示も消す
  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    const h = () => setFile(null);
    form.addEventListener("reset", h);
    return () => form.removeEventListener("reset", h);
  }, []);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const dropped = e.dataTransfer?.files;
    if (dropped && dropped.length > 0 && inputRef.current) {
      const dt = new DataTransfer();
      dt.items.add(dropped[0]); // 1ファイルのみ受け付ける
      inputRef.current.files = dt.files;
      sync();
    }
  };

  const fmtSize = (n: number) =>
    n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`;

  return (
    <label
      onDragEnter={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => {
        // 子要素間の移動では消さない（箱の外に出たときだけ解除）
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false);
      }}
      onDrop={onDrop}
      className={`flex min-w-0 cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border-2 border-dashed px-4 py-6 text-center transition ${
        over
          ? "border-gold-500 bg-gold-100"
          : file
            ? "border-gold-400 bg-white"
            : "border-gold-300 bg-white/70 hover:border-gold-400 hover:bg-gold-100/60"
      }`}
    >
      <input
        ref={inputRef}
        type="file"
        name={name}
        required={required}
        accept={accept}
        onChange={sync}
        className="sr-only"
      />
      {file ? (
        <>
          <span className="text-2xl" aria-hidden>
            📄
          </span>
          <span className="max-w-full break-all text-sm font-semibold text-ink">{file.name}</span>
          <span className="text-xs text-ink-soft">{fmtSize(file.size)}</span>
          <span className="text-[11px] text-gold-600 underline">別のファイルを選ぶ</span>
        </>
      ) : (
        <>
          <span
            className="flex h-10 w-10 items-center justify-center rounded-full bg-gold-500 text-lg text-white"
            aria-hidden
          >
            ⬆
          </span>
          <span className="text-sm font-bold text-ink">ファイルをここにドラッグ＆ドロップ</span>
          <span className="text-xs text-ink-soft">またはこの枠をタップして選択</span>
        </>
      )}
    </label>
  );
}
