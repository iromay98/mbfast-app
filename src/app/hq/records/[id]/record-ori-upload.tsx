"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadRecordOri, removeRecordOri } from "@/lib/actions/records";

// チューンド車用: 本店が純正(ori)binを事前アップしておくと、
// 代理店の「純正に戻す(ori)」ボタンがこの記録でも使えるようになる。
export function RecordOriUpload({
  recordId,
  oriFileName,
}: {
  recordId: string;
  oriFileName: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const onPick = (file: File | undefined) => {
    if (!file) return;
    setError(null);
    start(async () => {
      const fd = new FormData();
      fd.set("file", file);
      const r = await uploadRecordOri(recordId, fd);
      if (r.error) setError(r.error);
      router.refresh();
    });
  };

  const onRemove = () => {
    if (!window.confirm("登録済みの純正(ori)binを取り外します。よろしいですか？")) return;
    start(async () => {
      await removeRecordOri(recordId);
      router.refresh();
    });
  };

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      <span
        className="text-xs font-semibold text-rose-700"
        title="チューニング済み読みのため、読んだ中身は純正ではありません。本店が純正binを登録すると代理店が ori .slave をDLできます。"
      >
        ori（本店登録）
      </span>
      {oriFileName ? (
        <>
          <span className="max-w-[200px] truncate font-mono text-[11px] text-green-700" title={oriFileName}>
            ✓ {oriFileName}
          </span>
          <a
            href={`/api/records/${recordId}/stock-slave`}
            className="rounded-lg border border-gold-300 bg-white px-2.5 py-1 text-xs font-semibold text-gold-700 hover:bg-gold-50"
            title="登録済み純正をこの車用の ori .slave として確認DL"
          >
            ⬇ ori .slave
          </a>
          <button
            type="button"
            disabled={pending}
            onClick={() => inputRef.current?.click()}
            className="rounded-lg border border-line bg-white px-2.5 py-1 text-xs font-semibold text-ink-soft hover:bg-surface-2 disabled:opacity-50"
          >
            差し替え
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={onRemove}
            className="rounded-lg border border-red-200 bg-white px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            取り外す
          </button>
        </>
      ) : (
        <>
          <span className="text-[11px] text-ink-soft">
            未登録（登録すると代理店が「純正に戻す(ori)」を使えます）
          </span>
          <button
            type="button"
            disabled={pending}
            onClick={() => inputRef.current?.click()}
            className="rounded-lg bg-rose-500 px-2.5 py-1 text-xs font-semibold text-white disabled:opacity-50"
          >
            {pending ? "アップ中…" : "＋ 純正binを登録"}
          </button>
        </>
      )}
      <input
        ref={inputRef}
        type="file"
        accept=".bin,application/octet-stream"
        className="hidden"
        onChange={(e) => {
          onPick(e.target.files?.[0]);
          e.target.value = "";
        }}
      />
      {error && <span className="text-xs text-red-600">{error}</span>}
    </span>
  );
}
