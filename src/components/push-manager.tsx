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
  const [iosHint, setIosHint] = useState(false);

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
      // iPhone/iPadのブラウザ閲覧では通知APIが無い（ホーム画面に追加したアプリでのみ使える）。
      // その案内を一度だけ表示する。
      const w = globalThis as unknown as { matchMedia?: (q: string) => { matches: boolean } };
      const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const standalone =
        (w.matchMedia ? w.matchMedia("(display-mode: standalone)").matches : false) ||
        (navigator as unknown as { standalone?: boolean }).standalone === true;
      if (isIOS && !standalone && localStorage.getItem("iosPushHintDismissed") !== "1") {
        setIosHint(true);
      }
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

  if (iosHint) {
    return (
      <div className="fixed bottom-4 left-4 right-4 z-40 rounded-xl border border-gold-200 bg-white p-3 text-xs shadow-lg md:left-auto md:max-w-sm">
        <p className="mb-1 font-bold">📱 iPhoneで通知を受け取るには</p>
        <p className="text-ink-soft">
          Safariの共有ボタン →「<b>ホーム画面に追加</b>」→ 追加された<b>アイコンから開いて</b>「🔔 通知をオン」を押してください。
          （iPhoneの仕様で、ブラウザで開いたままでは通知が届きません）
        </p>
        <button
          type="button"
          onClick={() => {
            localStorage.setItem("iosPushHintDismissed", "1");
            setIosHint(false);
          }}
          className="mt-2 rounded-lg border border-line px-2 py-1 font-semibold text-ink-soft"
        >
          閉じる
        </button>
      </div>
    );
  }

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
