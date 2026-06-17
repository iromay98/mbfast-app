"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

// 案件チャットのフォアグラウンド通知。
// アプリ(タブ)を開いている間、相手からの新着メッセージをポーリングで検知し、
// ブラウザ通知を出して画面を更新する。
// ※ アプリを完全に閉じている時の通知(Web Push)は別途 VAPID 基盤が必要。
export function MessageNotifier({
  recordId,
  viewerRole,
}: {
  recordId: string;
  viewerRole: "HQ_ADMIN" | "DEALER";
}) {
  const router = useRouter();
  const lastSeen = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) return;
    // 許可を一度だけ要求（未決定のとき）。拒否でもポーリング更新は行う。
    if (Notification.permission === "default") {
      Notification.requestPermission().catch(() => {});
    }

    let stopped = false;
    const poll = async () => {
      try {
        const res = await fetch(`/api/records/${recordId}/messages/latest`, { cache: "no-store" });
        if (!res.ok) return;
        const data: { id: string | null; authorRole: string | null } = await res.json();
        const id = data.id;
        // 初回は基準値を記録するだけ（既存メッセージで通知しない）
        if (lastSeen.current === undefined) {
          lastSeen.current = id;
          return;
        }
        if (id && id !== lastSeen.current) {
          lastSeen.current = id;
          const incoming = data.authorRole && data.authorRole !== viewerRole;
          if (incoming) {
            const from = data.authorRole === "HQ_ADMIN" ? "本部" : "代理店";
            if ("Notification" in window && Notification.permission === "granted" && document.hidden) {
              try {
                new Notification(`${from}からメッセージ`, {
                  body: "この案件に新しいメッセージが届きました。",
                  tag: `record-${recordId}`,
                });
              } catch {
                /* 通知不可でも更新は行う */
              }
            }
            router.refresh();
          }
        }
      } catch {
        /* ネットワーク揺れは無視 */
      }
    };

    void poll();
    const timer = setInterval(() => {
      if (!stopped) void poll();
    }, 20000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [recordId, viewerRole, router]);

  return null;
}
