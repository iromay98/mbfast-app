"use client";

import { useEffect, useRef, useState, type DragEvent } from "react";

// ドラッグ&ドロップ対応のファイル選択ボックス。
// 中に通常の <input type="file"> を隠し持つので、フォーム送信・required 検証は従来どおり動く。
export function FileDropZone({
  name,
  required,
  accept,
  multiple,
  prompt,
  onFiles,
  clearAfterSelect,
}: {
  name: string;
  required?: boolean;
  accept?: string;
  multiple?: boolean; // 写真複数枚など
  prompt?: string; // 未選択時の見出し（省略時は汎用文言）
  onFiles?: (files: File[]) => void; // 選択・ドロップ時に親へ通知（ぼかし前処理など）
  // 選択を親に渡したら input を即クリアする（親が「追加方式」でリストを管理する場合。
  // 送信は親が組み立てるため、この場合フォームには input の値は乗らない）
  clearAfterSelect?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<{ name: string; size: number }[]>([]);
  const [over, setOver] = useState(false);
  const file = files[0] ?? null;

  const sync = () => {
    const list = inputRef.current?.files;
    const arr = list ? Array.from(list) : [];
    onFiles?.(arr);
    if (clearAfterSelect) {
      if (inputRef.current) inputRef.current.value = "";
      setFiles([]);
      return;
    }
    setFiles(arr.map((f) => ({ name: f.name, size: f.size })));
  };

  // form.reset()（アップロード成功時）で表示も消す
  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    const h = () => setFiles([]);
    form.addEventListener("reset", h);
    return () => form.removeEventListener("reset", h);
  }, []);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    const dropped = e.dataTransfer?.files;
    if (dropped && dropped.length > 0 && inputRef.current) {
      const dt = new DataTransfer();
      const take = multiple ? Array.from(dropped) : [dropped[0]];
      for (const f of take) dt.items.add(f);
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
        multiple={multiple}
        onChange={sync}
        className="sr-only"
      />
      {file ? (
        multiple ? (
          <>
            <span className="text-2xl" aria-hidden>
              📷
            </span>
            <span className="text-sm font-semibold text-ink">{files.length}枚選択中</span>
            <span className="max-w-full break-all text-[11px] text-ink-soft">
              {files.slice(0, 3).map((f) => f.name).join(" / ")}
              {files.length > 3 ? ` ほか${files.length - 3}枚` : ""}
            </span>
            <span className="text-[11px] text-gold-600 underline">選び直す</span>
          </>
        ) : (
          <>
            <span className="text-2xl" aria-hidden>
              📄
            </span>
            <span className="max-w-full break-all text-sm font-semibold text-ink">{file.name}</span>
            <span className="text-xs text-ink-soft">{fmtSize(file.size)}</span>
            <span className="text-[11px] text-gold-600 underline">別のファイルを選ぶ</span>
          </>
        )
      ) : (
        <>
          <span
            className="flex h-10 w-10 items-center justify-center rounded-full bg-gold-500 text-lg text-white"
            aria-hidden
          >
            ⬆
          </span>
          <span className="text-sm font-bold text-ink">
            {prompt ?? "ファイルをここにドラッグ＆ドロップ"}
          </span>
          <span className="text-xs text-ink-soft">またはこの枠をタップして選択</span>
        </>
      )}
    </label>
  );
}
