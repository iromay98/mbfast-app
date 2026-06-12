"use client";

import { useEffect } from "react";

// 本番ビルドでのみサービスワーカーを登録（dev はキャッシュ事故を避けるため無効）。
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (
      process.env.NODE_ENV === "production" &&
      "serviceWorker" in navigator
    ) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* 登録失敗は致命的でないため握りつぶす */
      });
    }
  }, []);
  return null;
}
