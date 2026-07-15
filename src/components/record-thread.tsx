import { Card } from "@/components/ui";
import { MessageComposer } from "@/components/message-composer";
import { ChatMessage, type ChatMsg } from "@/components/chat-message";

export type ThreadMessage = {
  id: string;
  authorId: string;
  authorRole: "HQ_ADMIN" | "DEALER";
  body: string | null;
  fileName: string | null;
  fileSize: number | null;
  createdAt: Date;
  deletedAt: Date | null;
  hqNote: string | null;
  dealerNote: string | null;
  redownloadable: boolean;
  downloadedAt: Date | null;
};

function dayLabel(d: Date): string {
  const t = new Date();
  const y = new Date(t.getTime() - 86400000);
  const same = (a: Date, b: Date) => a.toDateString() === b.toDateString();
  if (same(d, t)) return "今日";
  if (same(d, y)) return "昨日";
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
}

// 案件ごとの本部⇄代理店チャット（LINE/WhatsApp風）。日付区切り＋吹き出し。
export function RecordThread({
  recordId,
  messages,
  viewerRole,
  viewerId,
  canEncrypt = false,
  backupSupported = false,
}: {
  recordId: string;
  messages: ThreadMessage[];
  viewerRole: "HQ_ADMIN" | "DEALER";
  viewerId: string;
  canEncrypt?: boolean;
  backupSupported?: boolean;
}) {
  return (
    <Card className="p-0">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gold-500 text-sm">💬</span>
        <div>
          <h3 className="text-sm font-bold text-ink">この案件のやりとり</h3>
          <p className="text-[11px] text-ink-soft">本部⇄代理店のチャット（テストファイル送付・質問・別リクエスト）</p>
        </div>
      </div>

      {/* チャット本文（WhatsApp風の壁紙背景＋日付区切り） */}
      <div className="max-h-[30rem] space-y-2 overflow-y-auto bg-[#e9edea] px-3 py-4 dark:bg-surface-2/40">
        {messages.length === 0 ? (
          <p className="py-8 text-center text-xs text-ink-soft">まだメッセージはありません。下から送信できます。</p>
        ) : (
          messages.map((m, i) => {
            const prev = messages[i - 1];
            const showDay = !prev || prev.createdAt.toDateString() !== m.createdAt.toDateString();
            const cm: ChatMsg = {
              id: m.id,
              authorId: m.authorId,
              authorRole: m.authorRole,
              body: m.body,
              fileName: m.fileName,
              fileSize: m.fileSize,
              createdAt: m.createdAt.toISOString(),
              deletedAt: m.deletedAt ? m.deletedAt.toISOString() : null,
              hqNote: m.hqNote,
              dealerNote: m.dealerNote,
              redownloadable: m.redownloadable,
              downloadedAt: m.downloadedAt ? m.downloadedAt.toISOString() : null,
            };
            return (
              <div key={m.id} className="space-y-2">
                {showDay && (
                  <div className="flex justify-center">
                    <span className="rounded-full bg-black/10 px-3 py-0.5 text-[10px] font-semibold text-ink-soft">
                      {dayLabel(m.createdAt)}
                    </span>
                  </div>
                )}
                <ChatMessage recordId={recordId} m={cm} viewerRole={viewerRole} viewerId={viewerId} />
              </div>
            );
          })
        )}
      </div>

      <div className="border-t border-line px-4 py-3">
        <MessageComposer recordId={recordId} canEncrypt={canEncrypt} backupSupported={backupSupported} />
      </div>
    </Card>
  );
}
