import type { NotificationPayload } from "@/server/notifications";

/*
 * LINE 通知（Messaging API push）。
 * 本店が既に運用中の LINE 公式アカウント（Messaging API チャネル）から、
 * 全通知を LINE_NOTIFY_TO（本店のユーザーID or グループID）へ送る。
 * メール通知と同じく「プッシュ通知の保険」チャネル。宛先が代理店の通知も本店へ送る。
 *
 * 環境変数（未設定なら no-op）:
 *   LINE_CHANNEL_ACCESS_TOKEN  チャネルアクセストークン（長期）
 *   LINE_NOTIFY_TO             送信先ID（Uxxxx=ユーザー / Cxxxx=グループ。カンマ区切りで複数可）
 */

export function lineNotifyEnabled(): boolean {
  return !!process.env.LINE_CHANNEL_ACCESS_TOKEN && !!process.env.LINE_NOTIFY_TO;
}

export async function sendNotificationLine(payload: NotificationPayload): Promise<void> {
  if (!lineNotifyEnabled()) return;
  const token = process.env.LINE_CHANNEL_ACCESS_TOKEN!;
  const targets = process.env.LINE_NOTIFY_TO!.split(",").map((s) => s.trim()).filter(Boolean);
  if (targets.length === 0) return;

  const base = (process.env.AUTH_URL ?? "https://portal.mbfasttuning.com").replace(/\/+$/, "");
  const link = payload.link
    ? payload.link.startsWith("http")
      ? payload.link
      : `${base}${payload.link}`
    : null;
  const text = [`【${payload.title}】`, payload.message, ...(link ? [link] : [])].join("\n");

  for (const to of targets) {
    const res = await fetch("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to, messages: [{ type: "text", text }] }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error(`LINE通知の送信に失敗 (${res.status}): ${body.slice(0, 200)}`);
    }
  }
}
