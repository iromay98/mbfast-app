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

// 表示は常に日本時間（サーバーがUTCでもズレない）。短く MM/DD HH:mm。
function stamp(iso: string): string {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(iso));
}
function sizeLabel(n: number | null): string {
  if (n == null) return "";
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}KB`;
  return `${(n / 1024 / 1024).toFixed(1)}MB`;
}

// やり取り1件＝1カード。行数を抑え、送信元で左端に色帯を付けて境界を明確化。
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
  const [noteOpen, setNoteOpen] = useState(false);
  const mine = m.authorRole === viewerRole;
  const isHQ = m.authorRole === "HQ_ADMIN";
  const hasFile = !!m.fileName;
  const canRetract = !m.deletedAt && mine && (m.authorId === viewerId || viewerRole === "HQ_ADMIN");
  const myNote = viewerRole === "HQ_ADMIN" ? m.hqNote : m.dealerNote;
  const otherNote = viewerRole === "HQ_ADMIN" ? m.dealerNote : m.hqNote;
  const anyNote = !!(myNote || otherNote);

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
    <div
      className={`relative border-b border-line px-3 py-2 pl-4 last:border-0 ${
        m.deletedAt ? "bg-surface-2/40" : mine ? "bg-gold-50/40" : "bg-surface"
      }`}
    >
      {/* 左端の色帯: 本部=金 / 代理店=青。カードの切れ目と送信元が一目で分かる */}
      <span
        className={`absolute inset-y-0 left-0 w-1 ${isHQ ? "bg-gold-500" : "bg-sky-500"} ${
          m.deletedAt ? "opacity-30" : ""
        }`}
      />

      {/* ヘッダー1行: 種別 ＋ 送信元 ＋ 日時 ＋ 状態 ＋（右端）操作 */}
      <div className="flex items-center gap-1.5">
        <span className={`text-xs font-bold ${m.deletedAt ? "text-ink-soft" : "text-ink"}`}>
          {title}
        </span>
        <span className={`text-[10px] font-bold ${isHQ ? "text-gold-700" : "text-sky-700"}`}>
          {isHQ ? "本部" : "代理店"}
        </span>
        <span className="text-[10px] text-ink-soft">{stamp(m.createdAt)}</span>
        {m.downloadedAt && !m.deletedAt && (
          <span className="rounded bg-green-100 px-1 text-[10px] font-bold text-green-700">
            DL済
          </span>
        )}
        {!m.redownloadable && !m.deletedAt && hasFile && (
          <span className="rounded bg-surface-2 px-1 text-[10px] font-bold text-ink-soft">停止中</span>
        )}

        {/* 右端の操作（取り消し）。DLは下のファイル行に横並びで置く */}
        {canRetract && (
          <button
            type="button"
            disabled={pending}
            onClick={() => {
              if (window.confirm("この送信を取り消します（相手にも「削除済み」と表示）。よろしいですか？"))
                run(() => retractMessage(m.id));
            }}
            title="送信を取り消す"
            className="ml-auto shrink-0 rounded border border-red-200 px-1.5 py-0.5 text-[10px] font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            取消
          </button>
        )}
      </div>

      {m.deletedAt ? (
        <p className="mt-0.5 text-[11px] italic text-ink-soft">送信が取り消されました</p>
      ) : (
        <>
          {m.body && (
            <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-snug text-ink">
              {m.body}
            </p>
          )}

          {hasFile && (
            <div className="mt-1.5 space-y-1">
              {/* ファイル行: 名前 ＋（右端）DL・操作を横1列に */}
              <div className="flex items-center gap-2">
                <span
                  className="min-w-0 flex-1 truncate font-mono text-[11px] text-ink"
                  title={m.fileName ?? ""}
                >
                  📄 {m.fileName}
                  {m.fileSize != null && (
                    <span className="ml-1 text-ink-soft">({sizeLabel(m.fileSize)})</span>
                  )}
                </span>

                {/* 本部: 再DL可否も同じ行に（縦に伸ばさない） */}
                {viewerRole === "HQ_ADMIN" && (
                  <label
                    className="flex shrink-0 items-center gap-1 text-[10px] text-ink-soft"
                    title="代理店の再ダウンロードを許可（AutoTuner自動encryptで随時DL）"
                  >
                    <input
                      type="checkbox"
                      checked={m.redownloadable}
                      disabled={pending}
                      onChange={(e) => run(() => setMessageRedownloadable(m.id, e.target.checked))}
                      className="h-3 w-3 accent-gold-500"
                    />
                    再DL可
                  </label>
                )}

                {/* 備考トグル（普段は畳んでスペースを節約） */}
                <button
                  type="button"
                  onClick={() => setNoteOpen((o) => !o)}
                  title="ファイルの備考"
                  className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-semibold ${
                    anyNote
                      ? "border-gold-300 bg-gold-50 text-gold-700"
                      : "border-line text-ink-soft hover:bg-surface-2"
                  }`}
                >
                  備考{anyNote ? "●" : ""}
                </button>

                {/* 緑の目立つDLボタン */}
                {viewerRole === "DEALER" && !m.redownloadable ? (
                  <span className="shrink-0 rounded-full bg-surface-2 px-2.5 py-1 text-[10px] font-bold text-ink-soft">
                    DL停止
                  </span>
                ) : (
                  <SlaveDownloadButton
                    href={`/api/records/${recordId}/messages/${m.id}/file`}
                    label="⬇ DOWNLOAD"
                    fallbackName={m.fileName}
                    onDone={() => router.refresh()}
                    hideBar
                    className="inline-flex shrink-0 items-center gap-1 rounded-full bg-green-600 px-3 py-1 text-[11px] font-extrabold tracking-wide text-white shadow-sm hover:bg-green-700 disabled:opacity-70"
                  />
                )}
              </div>

              {/* 備考（開いた時だけ表示） */}
              {noteOpen && (
                <div className="space-y-1 rounded-lg bg-surface-2/70 p-1.5">
                  <NoteInput
                    value={myNote ?? ""}
                    onSave={(v) => run(() => setMessageFileNote(m.id, v))}
                    placeholder="このファイルの備考（相手にも見えます）"
                  />
                  {otherNote && (
                    <div className="text-[11px] text-ink-soft">
                      <span className="font-semibold">
                        {viewerRole === "HQ_ADMIN" ? "代理店" : "本部"}:{" "}
                      </span>
                      {otherNote}
                    </div>
                  )}
                </div>
              )}
              {/* 畳んでいる時も相手の備考は1行だけ見せる（見落とし防止） */}
              {!noteOpen && otherNote && (
                <div className="truncate text-[10px] text-ink-soft">
                  <span className="font-semibold">
                    {viewerRole === "HQ_ADMIN" ? "代理店" : "本部"}の備考:{" "}
                  </span>
                  {otherNote}
                </div>
              )}
            </div>
          )}
        </>
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
      className="w-full rounded border border-line bg-surface px-2 py-1 text-[11px] focus:border-gold-400 focus:outline-none"
    />
  );
}
