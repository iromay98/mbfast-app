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

// 案件ごとの本部⇄代理店のやり取り。OLSX風のイベントカード・タイムライン（新しい順）。
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
  // 新しいものを上に（OLSX同様）
  const ordered = [...messages].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return (
    <Card className="p-0">
      <div className="flex items-center gap-2 border-b border-line px-4 py-3">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gold-500 text-sm">💬</span>
        <div>
          <h3 className="text-sm font-bold text-ink">この案件のやりとり</h3>
          <p className="text-[11px] text-ink-soft">
            ファイル送受信・質問・別リクエストの履歴（新しい順）
          </p>
        </div>
      </div>

      {/* 入力は上（すぐ送れる） */}
      <div className="border-b border-line bg-surface-2/50 px-4 py-3">
        <MessageComposer recordId={recordId} canEncrypt={canEncrypt} backupSupported={backupSupported} />
      </div>

      {/* イベントカードの縦タイムライン */}
      <div className="max-h-[36rem] overflow-y-auto">
        {ordered.length === 0 ? (
          <p className="py-8 text-center text-xs text-ink-soft">
            まだやり取りはありません。上から送信できます。
          </p>
        ) : (
          ordered.map((m) => {
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
              <ChatMessage
                key={m.id}
                recordId={recordId}
                m={cm}
                viewerRole={viewerRole}
                viewerId={viewerId}
              />
            );
          })
        )}
      </div>
    </Card>
  );
}
