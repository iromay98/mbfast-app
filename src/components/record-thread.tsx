import { Card } from "@/components/ui";
import { formatDateTime } from "@/lib/labels";
import { MessageComposer } from "@/components/message-composer";

export type ThreadMessage = {
  id: string;
  authorRole: "HQ_ADMIN" | "DEALER";
  body: string | null;
  fileName: string | null;
  createdAt: Date;
};

// 案件ごとの本部⇄代理店メッセージ表示＋投稿。viewer から見て自分の発言は右寄せ。
export function RecordThread({
  recordId,
  messages,
  viewerRole,
  canEncrypt = false,
  backupSupported = false,
}: {
  recordId: string;
  messages: ThreadMessage[];
  viewerRole: "HQ_ADMIN" | "DEALER";
  canEncrypt?: boolean;
  // slave変換で bak(フル・マップスイッチ用) を選べるか（backup対応ECUのみ）。
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

      {/* チャット本文（LINE風の吹き出し） */}
      <div className="max-h-[28rem] space-y-3 overflow-y-auto bg-surface-2/40 px-4 py-4">
        {messages.length === 0 ? (
          <p className="py-8 text-center text-xs text-ink-soft">まだメッセージはありません。下から送信できます。</p>
        ) : (
          messages.map((m) => {
            const mine = m.authorRole === viewerRole;
            const isHQ = m.authorRole === "HQ_ADMIN";
            const avatar = isHQ ? "本" : "店";
            return (
              <div key={m.id} className={`flex items-end gap-2 ${mine ? "flex-row-reverse" : "flex-row"}`}>
                {/* アバター */}
                <span
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white ${
                    isHQ ? "bg-gold-500" : "bg-sky-500"
                  }`}
                  title={isHQ ? "本部" : "代理店"}
                >
                  {avatar}
                </span>
                <div className={`flex max-w-[78%] flex-col ${mine ? "items-end" : "items-start"}`}>
                  <span className="mb-0.5 px-1 text-[10px] text-ink-soft">
                    {isHQ ? "本部" : "代理店"}・{formatDateTime(m.createdAt)}
                  </span>
                  <div
                    className={`rounded-2xl px-3.5 py-2 text-sm shadow-sm ${
                      mine
                        ? "rounded-br-sm bg-gold-500 text-white"
                        : "rounded-bl-sm border border-line bg-white text-ink"
                    }`}
                  >
                    {m.body && <div className="whitespace-pre-wrap break-words">{m.body}</div>}
                    {m.fileName && (
                      <a
                        href={`/api/records/${recordId}/messages/${m.id}/file`}
                        className={`mt-1 inline-flex items-center gap-1 break-all text-xs font-semibold underline ${
                          mine ? "text-white" : "text-gold-700"
                        }`}
                      >
                        ⬇ {m.fileName}
                      </a>
                    )}
                  </div>
                </div>
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
