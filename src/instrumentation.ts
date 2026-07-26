// サーバー起動時に1回だけ実行されるフック（Next.js instrumentation）。
// バックグラウンドジョブの起動に使う。Edge/ビルド時には何もしない。
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  // 価格表の自動同期（PRICE_AUTO_SYNC=0 で無効化。WP認証が無ければ実行時に no-op）
  if (process.env.PRICE_AUTO_SYNC !== "0") {
    const { startPriceAutoSync } = await import("@/server/prices/auto-sync");
    startPriceAutoSync();
  }
}
