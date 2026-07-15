"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SlaveDownloadButton } from "@/components/slave-download-button";
import {
  retractMessage,
  setMessageFileNote,
  setMessageRedownloadable,
} from "@/lib/actions/messages";

export type ChatMsg = {
  id: string;
  authorId: string;
  authorRole: "HQ_ADMIN" | "DEALER";
  body: string | null;
  fileName: string | null;
  fileSize: number | null;
  createdAt: string; // ISO
  deletedAt: string | null;
  hqNote: string | null;
  dealerNote: string | null;
  redownloadable: boolean;
  downloadedAt: string | null;
};

function hm(iso: string): string {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}
function sizeLabel(n: number | null): string {
  if (n == null) return "";
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

// LINE/WhatsApp 風の1メッセージ。自分の発言は右・緑、相手は左・白。
export function ChatMessage({
  recordId,
  m,
  viewerRole,
  viewerId,
}: {
  recordId: string;
  m: ChatMsg;
  viewerRole: "HQ_ADMIN" | "DEALER";
  viewerId: string;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const mine = m.authorRole === viewerRole;
  const isHQ = m.authorRole === "HQ_ADMIN";
  const canRetract = !m.deletedAt && (m.authorId === viewerId || viewerRole === "HQ_ADMIN") && mine;
  const myNote = viewerRole === "HQ_ADMIN" ? m.hqNote : m.dealerNote;
  const otherNote = viewerRole === "HQ_ADMIN" ? m.dealerNote : m.hqNote;

  const run = (fn: () => Promise<{ ok?: true; error?: string }>) =>
    start(async () => {
      await fn();
      router.refresh();
    });

  if (m.deletedAt) {
    return (
      <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
        <span className="rounded-full bg-black/5 px-3 py-1 text-[11px] italic text-ink-soft">
          送信を取り消しました
        </span>
      </div>
    );
  }

  return (
    <div className={`flex items-end gap-1.5 ${mine ? "flex-row-reverse" : "flex-row"}`}>
      {!mine && (
        <span
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${
            isHQ ? "bg-gold-500" : "bg-sky-500"
          }`}
          title={isHQ ? "本部" : "代理店"}
        >
          {isHQ ? "本" : "店"}
        </span>
      )}
      <div className={`group flex max-w-[80%] flex-col ${mine ? "items-end" : "items-start"}`}>
        <div
          className={`relative rounded-2xl px-3 py-2 text-sm shadow-sm ${
            mine
              ? "rounded-br-md bg-[#d9fdd3] text-ink"
              : "rounded-bl-md border border-line bg-white text-ink"
          }`}
        >
          {m.body && <div className="whitespace-pre-wrap break-words pr-10">{m.body}</div>}

          {/* 添付ファイル: カード＋DLボタン＋DL済み＋備考 */}
          {m.fileName && (
            <div className="mt-1 rounded-lg border border-black/10 bg-white/70 p-2">
              <div className="flex items-center gap-2">
                <span className="text-lg">📄</span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-semibold text-ink" title={m.fileName}>
                    {m.fileName}
                  </div>
                  <div className="text-[10px] text-ink-soft">
                    {sizeLabel(m.fileSize)}
                    {m.downloadedAt ? "・相手DL済み" : ""}
                    {!m.redownloadable ? "・DL停止中" : ""}
                  </div>
                </div>
              </div>
              {/* DLボタン（押すとDL）。代理店はHQが再DL不可にしたら押せない */}
              {viewerRole === "DEALER" && !m.redownloadable ? (
                <span className="mt-1.5 inline-block rounded-lg bg-black/5 px-3 py-1 text-[11px] font-semibold text-ink-soft">
                  ダウンロード終了（本部が公開停止）
                </span>
              ) : (
                <div className="mt-1.5">
                  <SlaveDownloadButton
                    href={`/api/records/${recordId}/messages/${m.id}/file`}
                    label="⬇ ダウンロード"
                    fallbackName={m.fileName}
                    onDone={() => router.refresh()}
                    className="inline-flex items-center gap-1 rounded-lg bg-gold-500 px-3 py-1 text-[11px] font-bold text-white hover:bg-gold-600 disabled:opacity-70"
                  />
                </div>
              )}

              {/* 本部のみ: 再DL可否トグル */}
              {viewerRole === "HQ_ADMIN" && (
                <label className="mt-1.5 flex items-center gap-1 text-[10px] text-ink-soft">
                  <input
                    type="checkbox"
                    checked={m.redownloadable}
                    disabled={pending}
                    onChange={(e) => run(() => setMessageRedownloadable(m.id, e.target.checked))}
                    className="h-3 w-3 accent-gold-500"
                  />
                  代理店の再ダウンロードを許可（AutoTuner自動encryptで随時DL）
                </label>
              )}

              {/* ファイル備考（自分の欄は編集・相手の欄は表示） */}
              <div className="mt-1.5 space-y-1 border-t border-black/10 pt-1.5">
                <NoteInput
                  value={myNote ?? ""}
                  onSave={(v) => run(() => setMessageFileNote(m.id, v))}
                  placeholder="このファイルの備考（自分用メモ・相手にも見えます）"
                />
                {otherNote && (
                  <div className="rounded bg-black/5 px-2 py-1 text-[11px] text-ink-soft">
                    <span className="font-semibold">{isHQ ? "本部" : "代理店"}以外の備考: </span>
                    {otherNote}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* 時刻（吹き出し右下） */}
          <span className="pointer-events-none absolute bottom-1 right-2 text-[9px] text-ink-soft/70">
            {hm(m.createdAt)}
          </span>
        </div>

        {/* 取り消し（自分の発言のみ・ホバーで表示） */}
        {canRetract && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (window.confirm("この送信を取り消します（相手にも「取り消し」と表示）。よろしいですか？"))
                run(() => retractMessage(m.id));
            }}
            className="mt-0.5 px-1 text-[10px] text-ink-soft opacity-0 transition group-hover:opacity-100 hover:text-red-600"
          >
            送信を取り消す
          </button>
        )}
      </div>
    </div>
  );
}

function NoteInput({
  value,
  onSave,
  placeholder,
}: {
  value: string;
  onSave: (v: string) => void;
  placeholder: string;
}) {
  const [v, setV] = useState(value);
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    setV(value);
  }
  return (
    <input
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (v !== value) onSave(v.trim());
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
      }}
      className="w-full rounded border border-black/10 bg-white px-2 py-1 text-[11px] focus:border-gold-400 focus:outline-none"
    />
  );
}
