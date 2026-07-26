import { prisma } from "@/lib/db";
import { notify } from "@/server/notifications";
import { wpConfigured } from "@/lib/prices/wordpress";
import { syncWpPage } from "@/server/prices/wp-sync";

/*
 * 価格表の自動同期。
 * /hq/prices で編集されたら、10分おきのチェックで自動的にWordPressへ反映する
 * （手動の「WordPress同期」パネルは従来どおり使える。こちらは押し忘れ対策）。
 *
 * 安全設計:
 *  - 編集の3分後まで待つ（編集途中の中途半端な状態を公開しない）
 *  - guardThead: 列構成(thead)がライブと不一致のブランドがあるページは書き込まず通知のみ
 *    （ライブ側の手動並び替えを勝手に巻き戻さない）
 *  - 変更が無いページはWPに触らない（前回成功時刻とデータ更新時刻の比較で候補を絞る）
 *  - 結果は通知（成功=反映内容 / 保留・失敗=要確認）
 * 無効化: 環境変数 PRICE_AUTO_SYNC=0
 */

const QUIET_MS = 3 * 60 * 1000; // 編集が落ち着くまで待つ時間
const INTERVAL_MS = 10 * 60 * 1000;
const BOOT_DELAY_MS = 5 * 60 * 1000; // 起動直後は避ける（デプロイ直後の連続再起動対策）

let running = false;

export async function runPriceAutoSync(): Promise<void> {
  if (running) return; // 単一実行（前回が長引いていたら見送り）
  if (!wpConfigured()) return;
  running = true;
  try {
    const brands = await prisma.priceBrand.findMany({
      where: { wordPressPageId: { not: null } },
      select: { id: true, displayName: true, wordPressPageId: true, updatedAt: true },
    });
    const pages = new Map<number, { ids: string[]; names: string[]; updatedAt: Date }>();
    for (const b of brands) {
      const p = pages.get(b.wordPressPageId!) ?? { ids: [], names: [], updatedAt: new Date(0) };
      p.ids.push(b.id);
      p.names.push(b.displayName);
      if (b.updatedAt > p.updatedAt) p.updatedAt = b.updatedAt;
      pages.set(b.wordPressPageId!, p);
    }

    const now = Date.now();
    for (const [pageId, page] of pages) {
      // データの最終更新時刻（ブランド設定 or 車両行）
      const vMax = await prisma.priceVehicle.aggregate({
        _max: { updatedAt: true },
        where: { brandId: { in: page.ids } },
      });
      const lastEdit = Math.max(page.updatedAt.getTime(), vMax._max.updatedAt?.getTime() ?? 0);

      const lastSuccess = await prisma.priceSyncLog.findFirst({
        where: { wpPageId: pageId, status: "success" },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      });

      // 前回成功以降に編集が無ければ何もしない（WPにも触らない）
      if (lastSuccess && lastEdit <= lastSuccess.createdAt.getTime()) continue;
      // 編集直後は見送り（次の周期で拾う）
      if (now - lastEdit < QUIET_MS) continue;

      try {
        const res = await syncWpPage(pageId, { dryRun: false, guardThead: true });
        if (res.status === "success") {
          const changed = res.brands.filter((b) => b.changed).map((b) => b.displayName);
          if (changed.length > 0) {
            await notify({
              type: "PRICE_AUTO_SYNC",
              title: "価格表をホームページへ自動反映しました",
              message: `${changed.join(" / ")} の価格表を更新（ページ${pageId}）`,
              dealerId: null,
              link: "/hq/prices",
            });
          }
        } else if (res.status === "guarded" || res.status === "failed") {
          await notify({
            type: "PRICE_AUTO_SYNC",
            title: res.status === "guarded" ? "価格表の自動反映を保留しました" : "価格表の自動反映に失敗しました",
            message: res.error ?? `ページ${pageId}（${page.names.join(" / ")}）`,
            dealerId: null,
            link: "/hq/prices",
          });
        }
        // skipped（hash同一）は通知不要
      } catch (e) {
        console.error(`価格表の自動同期でエラー (page=${pageId})`, e);
      }
    }
  } finally {
    running = false;
  }
}

// サーバー起動時に1回だけ呼ぶ（instrumentation.ts から）。HMR での二重起動を防ぐ。
const g = globalThis as unknown as { __priceAutoSyncTimer?: ReturnType<typeof setInterval> };
export function startPriceAutoSync(): void {
  if (g.__priceAutoSyncTimer) return;
  g.__priceAutoSyncTimer = setInterval(() => void runPriceAutoSync(), INTERVAL_MS);
  setTimeout(() => void runPriceAutoSync(), BOOT_DELAY_MS);
  console.log("価格表の自動同期を有効化（10分間隔・列構成ガード付き）");
}
