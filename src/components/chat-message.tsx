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

function stamp(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}
function sizeLabel(n: number | null): string {
  if (n == null) return "";
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

// OLSX風のイベントカード。1件＝1カード（ファイル送信/受信・メッセージ送信/受信）。
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
  const hasFile = !!m.fileName;
  const canRetract = !m.deletedAt && mine && (m.authorId === viewerId || viewerRole === "HQ_ADMIN");
  const myNote = viewerRole === "HQ_ADMIN" ? m.hqNote : m.dealerNote;
  const otherNote = viewerRole === "HQ_ADMIN" ? m.dealerNote : m.hqNote;

  const title = m.deletedAt
    ? "削除済み"
    : hasFile
      ? mine
        ? "ファイル送信"
        : "ファイル受信"
      : mine
        ? "メッセージ送信"
        : "メッセージ受信";

  const run = (fn: () => Promise<{ ok?: true; error?: string }>) =>
    start(async () => {
      await fn();
      router.refresh();
    });

  return (
    <div className="border-b border-line bg-surface px-4 py-3 last:border-0">
      {/* 見出し行: タイトル ＋ 右端に操作 */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span
              className={`text-sm font-bold ${m.deletedAt ? "text-ink-soft" : "text-ink"}`}
            >
              {title}
            </span>
            <span
              className={`rounded px-1.5 py-0.5 text-[10px] font-bold text-white ${
                isHQ ? "bg-gold-500" : "bg-sky-500"
              }`}
            >
              {isHQ ? "本部" : "代理店"}
            </span>
          </div>
          <div className="mt-0.5 text-[11px] text-ink-soft">{stamp(m.createdAt)}</div>
        </div>
        {canRetract && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (window.confirm("この送信を取り消します（相手にも「削除済み」と表示）。よろしいですか？"))
                run(() => retractMessage(m.id));
            }}
            title="送信を取り消す"
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-sky-500 text-white hover:bg-sky-600 disabled:opacity-50"
          >
            🗑
          </button>
        )}
      </div>

      {m.deletedAt ? (
        <p className="mt-2 border-t border-line pt-2 text-xs italic text-ink-soft">
          送信が取り消されました
        </p>
      ) : (
        <div className="mt-2 space-y-2 border-t border-line pt-2">
          {m.body && (
            <p className="whitespace-pre-wrap break-words text-sm text-ink">{m.body}</p>
          )}

          {hasFile && (
            <div className="space-y-2">
              {/* ファイル名（OLSX風の赤ラベル） */}
              <p className="break-all text-sm">
                <span className="font-semibold text-rose-600">ファイル名 : </span>
                <span className="text-ink">{m.fileName}</span>
                {m.fileSize != null && (
                  <span className="ml-1 text-[11px] text-ink-soft">({sizeLabel(m.fileSize)})</span>
                )}
              </p>

              {/* 状態バッジ */}
              <div className="flex flex-wrap items-center gap-1.5">
                {m.downloadedAt && (
                  <span className="rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-bold text-green-700">
                    相手DL済み
                  </span>
                )}
                {!m.redownloadable && (
                  <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold text-ink-soft">
                    DL停止中
                  </span>
                )}
              </div>

              {/* 操作行（OLSX風のボタン列） */}
              <div className="flex flex-wrap items-center gap-2">
                {viewerRole === "DEALER" && !m.redownloadable ? (
                  <span className="rounded-lg border border-line px-3 py-2 text-xs font-semibold text-ink-soft">
                    ダウンロード終了（本部が公開停止）
                  </span>
                ) : (
                  <SlaveDownloadButton
                    href={`/api/records/${recordId}/messages/${m.id}/file`}
                    label="⬇ ダウンロード"
                    fallbackName={m.fileName}
                    onDone={() => router.refresh()}
                    className="inline-flex items-center gap-1 rounded-lg border border-line bg-white px-3 py-2 text-xs font-bold text-gold-700 hover:bg-gold-50 disabled:opacity-70"
                  />
                )}
              </div>

              {/* 本部のみ: 再DL可否 */}
              {viewerRole === "HQ_ADMIN" && (
                <label className="flex items-center gap-1.5 text-[11px] text-ink-soft">
                  <input
                    type="checkbox"
                    checked={m.redownloadable}
                    disabled={pending}
                    onChange={(e) => run(() => setMessageRedownloadable(m.id, e.target.checked))}
                    className="h-3.5 w-3.5 accent-gold-500"
                  />
                  代理店の再ダウンロードを許可（AutoTuner自動encryptで随時DL）
                </label>
              )}

              {/* 備考（お互いに記入可） */}
              <div className="space-y-1">
                <div className="text-[11px] font-semibold text-rose-600">備考</div>
                <NoteInput
                  value={myNote ?? ""}
                  onSave={(v) => run(() => setMessageFileNote(m.id, v))}
                  placeholder="このファイルの備考（相手にも見えます）"
                />
                {otherNote && (
                  <div className="rounded bg-surface-2 px-2 py-1 text-[11px] text-ink-soft">
                    {/* 相手側＝閲覧者の反対のロール（メッセージ送信者ではない） */}
                    <span className="font-semibold">
                      {viewerRole === "HQ_ADMIN" ? "代理店" : "本部"}の備考:{" "}
                    </span>
                    {otherNote}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
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
      className="w-full rounded-lg border border-line bg-surface px-2 py-1.5 text-xs focus:border-gold-400 focus:outline-none"
    />
  );
}
