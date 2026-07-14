"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  uploadRecordHqFile,
  updateRecordHqFileNote,
  deleteRecordHqFile,
} from "@/lib/actions/records";

export type HqFileRow = {
  id: string;
  fileName: string;
  fileSize: number | null;
  note: string | null;
  createdAtLabel: string;
};

function sizeLabel(n: number | null): string {
  if (n == null) return "";
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

// 本店専用の顧客関連ファイル置き場（代理店には一切公開しない）。備考付き。
export function HqFiles({ recordId, files }: { recordId: string; files: HqFileRow[] }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const router = useRouter();

  const upload = (file: File | undefined) => {
    if (!file) return;
    setError(null);
    start(async () => {
      const fd = new FormData();
      fd.set("file", file);
      if (note.trim()) fd.set("note", note.trim());
      const r = await uploadRecordHqFile(recordId, fd);
      if (r.error) setError(r.error);
      else setNote("");
      router.refresh();
    });
  };

  const saveNote = (fileId: string, v: string) =>
    start(async () => {
      await updateRecordHqFileNote(fileId, v);
      router.refresh();
    });

  const remove = (fileId: string, name: string) => {
    if (!window.confirm(`「${name}」を削除します。よろしいですか？`)) return;
    start(async () => {
      await deleteRecordHqFile(fileId);
      router.refresh();
    });
  };

  return (
    <div className="space-y-2">
      {files.length > 0 && (
        <div className="divide-y divide-line rounded-lg border border-line">
          {files.map((f) => (
            <div key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5">
              <a
                href={`/api/records/${recordId}/hq-files/${f.id}`}
                className="max-w-[240px] truncate font-mono text-xs text-gold-700 underline"
                title={f.fileName}
              >
                {f.fileName}
              </a>
              <span className="text-[11px] text-ink-soft">
                {sizeLabel(f.fileSize)}・{f.createdAtLabel}
              </span>
              {/* 備考: クリックで編集・blurで保存 */}
              <NoteCell value={f.note ?? ""} onSave={(v) => saveNote(f.id, v)} />
              <button
                type="button"
                disabled={pending}
                onClick={() => remove(f.id, f.fileName)}
                className="ml-auto rounded border border-red-200 px-2 py-0.5 text-[11px] font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
              >
                削除
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 追加（備考＋ファイル。ドロップ可） */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          upload(e.dataTransfer.files?.[0]);
        }}
        className={`flex flex-wrap items-center gap-2 rounded-lg border border-dashed px-3 py-2 ${
          drag ? "border-gold-400 bg-gold-50" : "border-line"
        }`}
      >
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="備考（例: 現車ログ・見積書）"
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1 text-xs"
        />
        <button
          type="button"
          disabled={pending}
          onClick={() => inputRef.current?.click()}
          className="rounded-lg bg-gold-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          {pending ? "アップ中…" : "＋ ファイルを追加"}
        </button>
        <span className="text-[11px] text-ink-soft">ドロップでも追加できます</span>
        <input
          ref={inputRef}
          type="file"
          className="hidden"
          onChange={(e) => {
            upload(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

function NoteCell({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const [v, setV] = useState(value);
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    setV(value);
  }
  return (
    <input
      value={v}
      placeholder="備考"
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (v !== value) onSave(v.trim());
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setV(value);
          e.currentTarget.blur();
        }
      }}
      className="min-w-[10rem] flex-1 rounded border border-transparent bg-transparent px-1.5 py-0.5 text-xs hover:border-line focus:border-gold-400 focus:bg-surface focus:outline-none"
    />
  );
}
