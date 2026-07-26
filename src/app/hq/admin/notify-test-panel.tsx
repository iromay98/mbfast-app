"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { sendTestNotification } from "@/lib/actions/admin";

// 通知経路の疎通テスト。押すと全チャネルへテスト通知を送り、設定状況を表示する。
export function NotifyTestPanel() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<{ push: boolean; email: boolean; line: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = () =>
    start(async () => {
      setError(null);
      try {
        const r = await sendTestNotification();
        setResult(r.channels);
      } catch {
        setError("送信に失敗しました");
      }
    });

  const mark = (on: boolean) => (on ? "✅ 設定済み（届いたか確認）" : "— 未設定");

  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-soft">
        Web Push・メール・LINE の全チャネルへテスト通知を送ります。届かないチャネルは設定（環境変数）か受信側の状態を確認してください。
      </p>
      <Button onClick={run} disabled={pending} variant="secondary">
        {pending ? "送信中…" : "テスト通知を送る"}
      </Button>
      {result && (
        <ul className="space-y-0.5 text-xs text-ink">
          <li>Web Push（スマホ/PCの通知）: {mark(result.push)}</li>
          <li>メール: {mark(result.email)}</li>
          <li>LINE: {mark(result.line)}</li>
        </ul>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
