import webpush from "web-push";
import { prisma } from "@/lib/db";

// VAPID 設定（環境変数）。未設定ならプッシュは無効（送信時に no-op）。
const PUBLIC = process.env.VAPID_PUBLIC_KEY ?? "";
const PRIVATE = process.env.VAPID_PRIVATE_KEY ?? "";
const SUBJECT = process.env.VAPID_SUBJECT ?? "mailto:admin@example.com";

let configured = false;
let configError: string | null = null;
function ensureConfigured(): boolean {
  if (configured) return true;
  if (!PUBLIC || !PRIVATE) return false;
  try {
    // キーが不正（長さ違い・貼り付けミス等）でもアプリを落とさず、無効として扱う
    webpush.setVapidDetails(SUBJECT, PUBLIC, PRIVATE);
    configured = true;
    configError = null;
    return true;
  } catch (e) {
    configError = e instanceof Error ? e.message : String(e);
    console.error(`VAPIDキーが不正なため Web Push は無効です: ${configError}`);
    return false;
  }
}

export function pushEnabled(): boolean {
  return !!PUBLIC && !!PRIVATE;
}

/** キーが設定されているのに使えない場合、その理由を返す（診断用）。正常なら null。 */
export function pushConfigError(): string | null {
  if (!pushEnabled()) return null;
  ensureConfigured();
  return configError;
}

export function vapidPublicKey(): string {
  return PUBLIC;
}

export type PushPayload = { title: string; body: string; url?: string; tag?: string };

// 送信結果のサマリ（診断用）。failedByStatus 例: { "403": 5 } → VAPIDキー不一致の典型。
export type PushSendResult = {
  subs: number; // 対象購読数
  ok: number;
  failedByStatus: Record<string, number>;
};

// 指定ユーザー群の全購読へプッシュ送信。期限切れ(404/410)購読は掃除する。
// 失敗はエラーコード別に集計してログ・戻り値に残す（従来は握りつぶしていて原因が見えなかった）。
export async function sendPushToUsers(
  userIds: string[],
  payload: PushPayload,
): Promise<PushSendResult> {
  const result: PushSendResult = { subs: 0, ok: 0, failedByStatus: {} };
  if (!ensureConfigured() || userIds.length === 0) return result;
  const subs = await prisma.pushSubscription.findMany({
    where: { userId: { in: userIds } },
    select: { id: true, endpoint: true, p256dh: true, auth: true },
  });
  result.subs = subs.length;
  if (subs.length === 0) return result;

  const data = JSON.stringify(payload);
  const dead: string[] = [];
  await Promise.all(
    subs.map(async (s) => {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          data,
        );
        result.ok++;
      } catch (e: unknown) {
        const code = (e as { statusCode?: number })?.statusCode;
        const key = code != null ? String(code) : "network";
        result.failedByStatus[key] = (result.failedByStatus[key] ?? 0) + 1;
        if (code === 404 || code === 410) dead.push(s.id); // 失効購読
        else {
          const body = (e as { body?: string })?.body;
          console.error(
            `Web Push送信失敗 (${key})${body ? `: ${String(body).slice(0, 150)}` : ""}`,
          );
        }
      }
    }),
  );
  if (dead.length > 0) {
    await prisma.pushSubscription.deleteMany({ where: { id: { in: dead } } }).catch(() => {});
  }
  return result;
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
