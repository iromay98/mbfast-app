"use client";

import { useCallback, useEffect, useState } from "react";
import { savePushSubscription } from "@/lib/actions/push";

// base64url(VAPID公開鍵) → Uint8Array
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

// Web Push の購読管理。ログイン済みレイアウトに常駐。
//  - SW 登録
//  - 通知許可済みなら自動で購読＆サーバ保存（端末を閉じても新着チャットを通知）
//  - 未許可(default)のときだけ小さな「🔔 通知をオン」ボタンを表示
export function PushManager() {
  const [perm, setPerm] = useState<NotificationPermission | "unsupported">("default");
  const [done, setDone] = useState(false);

  const subscribe = useCallback(async () => {
    try {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const res = await fetch("/api/push/public-key", { cache: "no-store" });
      if (!res.ok) return;
      const { key } = (await res.json()) as { key: string | null };
      if (!key) return; // サーバ側 VAPID 未設定
      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key) as BufferSource,
        });
      }
      const json = sub.toJSON() as { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
      if (json.endpoint && json.keys?.p256dh && json.keys?.auth) {
        await savePushSubscription({
          endpoint: json.endpoint,
          p256dh: json.keys.p256dh,
          auth: json.keys.auth,
        });
        setDone(true);
      }
    } catch {
      /* 失敗しても致命的でない（フォアグラウンド通知は別途動作） */
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setPerm("unsupported");
      return;
    }
    setPerm(Notification.permission);
    if (Notification.permission === "granted") void subscribe();
  }, [subscribe]);

  const enable = async () => {
    if (!("Notification" in window)) return;
    const p = await Notification.requestPermission();
    setPerm(p);
    if (p === "granted") void subscribe();
  };

  if (perm !== "default") return null; // granted=自動購読済 / denied・unsupported=非表示

  return (
    <button
      type="button"
      onClick={enable}
      className="fixed bottom-4 right-4 z-40 inline-flex items-center gap-1 rounded-full bg-gold-500 px-4 py-2 text-xs font-semibold text-white shadow-lg hover:bg-gold-600"
      title="チャット新着のプッシュ通知を受け取る（アプリを閉じていても届きます）"
    >
      🔔 通知をオン{done ? "（設定済み）" : ""}
    </button>
  );
}
