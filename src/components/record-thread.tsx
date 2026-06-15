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
}: {
  recordId: string;
  messages: ThreadMessage[];
  viewerRole: "HQ_ADMIN" | "DEALER";
  canEncrypt?: boolean;
}) {
  return (
    <Card>
      <h3 className="mb-2 text-sm font-bold text-ink">この案件のやりとり</h3>
      <p className="mb-3 text-xs text-ink-soft">
        本部からのテストファイル送付、代理店からの質問・別リクエストはここで行えます。
      </p>

      <div className="mb-3 max-h-96 space-y-2 overflow-y-auto">
        {messages.length === 0 ? (
          <p className="py-4 text-center text-xs text-ink-soft">まだメッセージはありません。</p>
        ) : (
          messages.map((m) => {
            const mine = m.authorRole === viewerRole;
            return (
              <div key={m.id} className={mine ? "text-right" : "text-left"}>
                <div
                  className={`inline-block max-w-[85%] rounded-lg px-3 py-2 text-left text-sm ${
                    mine ? "bg-gold-50" : "bg-surface-2"
                  }`}
                >
                  <div className="mb-0.5 text-[11px] text-ink-soft">
                    {m.authorRole === "HQ_ADMIN" ? "本部" : "代理店"}・{formatDateTime(m.createdAt)}
                  </div>
                  {m.body && <div className="whitespace-pre-wrap text-ink">{m.body}</div>}
                  {m.fileName && (
                    <a
                      href={`/api/records/${recordId}/messages/${m.id}/file`}
                      className="mt-1 inline-block font-mono text-xs font-semibold text-gold-700 underline"
                    >
                      ⬇ {m.fileName}
                    </a>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="border-t border-line pt-3">
        <MessageComposer recordId={recordId} canEncrypt={canEncrypt} />
      </div>
    </Card>
  );
}
