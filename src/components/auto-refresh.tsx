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
    const t = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(t);
  }, [active, intervalMs, router]);
  return null;
}
