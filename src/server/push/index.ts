import webpush from "web-push";
import { prisma } from "@/lib/db";

// VAPID 設定（環境変数）。未設定ならプッシュは無効（送信時に no-op）。
const PUBLIC = process.env.VAPID_PUBLIC_KEY ?? "";
const PRIVATE = process.env.VAPID_PRIVATE_KEY ?? "";
const SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:admin@example.com";

let configured = false;
function ensureConfigured(): boolean {
  if (configured) return true;
  if (!PUBLIC || !PRIVATE) return false;
  webpush.setVapidDetails(SUBJECT, PUBLIC, PRIVATE);
  configured = true;
  return true;
}

export function pushEnabled(): boolean {
  return !!PUBLIC && !!PRIVATE;
}

export function vapidPublicKey(): string {
  return PUBLIC;
}

export type PushPayload = { title: string; body: string; url?: string; tag?: string };

// 指定ユーザー群の全購読へプッシュ送信。期限切れ(404/410)購読は掃除する。
export async function sendPushToUsers(userIds: string[], payload: PushPayload): Promise<void> {
  if (!ensureConfigured() || userIds.length === 0) return;
  const subs = await prisma.pushSubscription.findMany({
    where: { userId: { in: userIds } },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });
  if (subs.length === 0) return;

  const data = JSON.stringify(payload);
  const dead: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          data,
        );
      } catch (e: unknown) {
        const code = (e as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) dead.push(s.id); // 失効購読
      }
    }),
  );
  if (dead.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: dead } } }).catch(() => {});
  }
}

// 役割/代理店で宛先ユーザーIDを解決（チャット相手＝もう一方）。
export async function recipientUserIds(opts: {
  toHQ: boolean;
  dealerId?: string | null;
}): Promise<string[]> {
  const users = await prisma.user.findMany({
    where: opts.toHQ ? { role: "HQ_ADMIN" } : { role: "DEALER", dealerId: opts.dealerId ?? undefined },
    select: { id: true },
  });
  return users.map((u) => u.id);
}
