"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

// 解析中の行がある間だけ、数秒ごとに router.refresh() してサーバー再描画を取り込む。
// （after() のバックグラウンド復号が DECODED へ進むと自動的に表示が更新される）
export function AutoRefresh({
  active,
  intervalMs = 3000,
}: {
  active: boolean;
  intervalMs?: number;
}) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    let count = 0;
    const maxTicks = Math.ceil((3 * 60 * 1000) / intervalMs); // 約3分で打ち切り（無限ポーリング防止）
    const t = setInterval(() => {
      // バックグラウンドのタブでは更新しない（操作・遷移との競合や無駄な再取得を避ける）
      if (typeof document !== "undefined" && document.hidden) return;
      if (++count > maxTicks) {
        clearInterval(t);
        return;
      }
      router.refresh();
    }, intervalMs);
    return () => clearInterval(t);
  }, [active, intervalMs, router]);
  return null;
}
