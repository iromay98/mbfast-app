"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { sendTestNotification, type TestNotifyResult } from "@/lib/actions/admin";

// 通知経路の疎通テスト。押すと各チャネルへテスト送信し、結果（Web Pushは成功/失敗内訳）を表示。
export function NotifyTestPanel() {
  const [pending, start] = useTransition();
  const [result, setResult] = useState<TestNotifyResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = () =>
    start(async () => {
      setError(null);
      try {
        setResult(await sendTestNotification());
      } catch {
        setError("送信に失敗しました");
      }
    });

  const failedText = (m: Record<string, number>) =>
    Object.entries(m)
      .map(([code, n]) => `${code}×${n}`)
      .join(" / ");

  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-soft">
        Web Push・メール・LINE へテスト通知を送り、送信結果を表示します。届かないチャネルの原因調査にも使えます。
      </p>
      <Button onClick={run} disabled={pending} variant="secondary">
        {pending ? "送信中…" : "テスト通知を送る"}
      </Button>
      {result && (
        <ul className="space-y-0.5 text-xs text-ink">
          <li>
            Web Push:{" "}
            {!result.push.enabled ? (
              "— 未設定（VAPIDキーなし）"
            ) : result.push.subs === 0 ? (
              "⚠ 購読なし（本店アカウントでポータルを開き「🔔 通知をオン」を押してください）"
            ) : (
              <>
                購読{result.push.subs}件 → 成功{result.push.sent}件
                {Object.keys(result.push.failedByStatus).length > 0 && (
                  <span className="font-semibold text-red-600">
                    {" "}
                    / 失敗 {failedText(result.push.failedByStatus)}
                    {result.push.failedByStatus["403"] ? "（403=VAPIDキー不一致の可能性）" : ""}
                  </span>
                )}
              </>
            )}
          </li>
          <li>
            メール: {result.email.enabled ? "✅ 送信（届いたか確認）" : "— 未設定"}
            {result.email.error && <span className="text-red-600"> エラー: {result.email.error}</span>}
          </li>
          <li>
            LINE: {result.line.enabled ? "✅ 送信（届いたか確認）" : "— 未設定"}
            {result.line.error && <span className="text-red-600"> エラー: {result.line.error}</span>}
          </li>
        </ul>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
