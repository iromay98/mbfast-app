/*
 * 通知サービス抽象化レイヤー。
 * MVP は console 出力のスタブ。本番は LINE Messaging API 実装に差し替える。
 * 呼び出し側はこの `notify()` だけを使い、ドライバは環境変数で切替える。
 */

export type NotificationType =
  | "REQUEST_CREATED" // 代理店→本店 依頼作成
  | "REQUEST_STATUS_CHANGED" // 本店→代理店 ステータス変更
  | "REQUEST_DELIVERED" // 本店→代理店 納品
  | "ANNOUNCEMENT_PUBLISHED" // 本店→代理店 お知らせ公開
  | "DEALER_ACCOUNT_ISSUED" // アカウント発行
  | "SLAVE_DECODED" // スレーブ復号成功（→本店）
  | "SLAVE_DECRYPT_FAILED" // スレーブ復号失敗（→本店）
  | "CATALOG_MATCH" // 照合一致・配布可ファイルあり（→代理店）
  | "STOCK_CAPTURED" // 未整備ストックを自動取込（→本店・要mod登録）
  | "RECORD_MESSAGE" // 案件のメッセージ（本部⇄代理店）
  | "CANCEL_REQUESTED" // 代理店→本店 誤DL/誤リクエストのキャンセル依頼
  | "CANCEL_RESOLVED" // 本店→代理店 キャンセル依頼の承諾/却下
  | "PIT_PUBLISHED" // mbPIT 記事公開完了（→店舗）
  | "PIT_HELD" // mbPIT ガード保留（→本部・要確認）
  | "PIT_FAILED"; // mbPIT 生成/公開エラー（→本部）

export type NotificationPayload = {
  type: NotificationType;
  title: string;
  message: string;
  /** 宛先の代理店（null は本店宛て/全体） */
  dealerId?: string | null;
  /** 関連リソースへのパス（任意） */
  link?: string;
};

export interface NotificationService {
  send(payload: NotificationPayload): Promise<void>;
}

// ── console スタブ実装（MVP） ───────────────────
class ConsoleNotificationService implements NotificationService {
  async send(payload: NotificationPayload): Promise<void> {
    console.log(
      `🔔 [通知:${payload.type}] dealer=${payload.dealerId ?? "-"} ${payload.title} — ${payload.message}` +
        (payload.link ? ` (${payload.link})` : ""),
    );
  }
}

// ── 本番 LINE 実装（差し替え用の雛形） ──────────
// 本店は既に LINE Messaging API を利用中。本番ではここを実装し
// NOTIFICATION_DRIVER=line に切替える。
//
// class LineNotificationService implements NotificationService {
//   constructor(private accessToken: string) {}
//   async send(payload: NotificationPayload): Promise<void> {
//     // 1. dealerId から通知先(LINEユーザー/グループID)を解決
//     // 2. POST https://api.line.me/v2/bot/message/push
//     //    headers: { Authorization: `Bearer ${this.accessToken}` }
//     //    body: { to, messages: [{ type: "text", text: `${payload.title}\n${payload.message}` }] }
//   }
// }

function createService(): NotificationService {
  const driver = process.env.NOTIFICATION_DRIVER ?? "console";
  switch (driver) {
    // case "line":
    //   return new LineNotificationService(process.env.LINE_CHANNEL_ACCESS_TOKEN!);
    case "console":
    default:
      return new ConsoleNotificationService();
  }
}

// シングルトン
const service = createService();

export async function notify(payload: NotificationPayload): Promise<void> {
  try {
    await service.send(payload);
  } catch (err) {
    // 通知失敗は業務処理を止めない
    console.error("通知の送信に失敗しました", err);
  }
}
