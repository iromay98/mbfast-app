import { prisma } from "@/lib/db";
import { notify } from "@/server/notifications";
import { wpConfigured } from "@/lib/prices/wordpress";
import { buildPagePayload, syncWpPage } from "@/server/prices/wp-sync";

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

const g = globalThis as unknown as {
  __priceAutoSyncTimer?: ReturnType<typeof setInterval>;
  /** 直前に送った通知の本文。同じ内容の連投を抑える */
  __priceAutoSyncLastDigest?: string;
};

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
    const synced: string[] = [];
    const held: string[] = [];
    const failed: string[] = [];

    for (const [pageId, page] of pages) {
      // データの最終更新時刻（ブランド設定 or 車両行）
      const vMax = await prisma.priceVehicle.aggregate({
        _max: { updatedAt: true },
        where: { brandId: { in: page.ids } },
      });
      const lastEdit = Math.max(page.updatedAt.getTime(), vMax._max.updatedAt?.getTime() ?? 0);

      // 前回の実行結果（skippedは除く）。保留/失敗の再通知抑止にも使う
      const lastLog = await prisma.priceSyncLog.findFirst({
        where: { wpPageId: pageId, status: { in: ["success", "guarded", "failed"] } },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true, status: true, payloadHash: true },
      });

      const editedSinceLast = !lastLog || lastEdit > lastLog.createdAt.getTime();
      if (!editedSinceLast) {
        // 編集なし: 反映済みなら何もしない。前回が保留/失敗でも、生成内容が前回と
        // 同じなら再試行しない（同じ結果になるだけ＝10分ごとの再通知スパム防止）。
        if (lastLog!.status === "success") continue;
        /*
         * 前回が保留/失敗のとき、生成内容が前回と同じなら再試行しない（再通知スパム防止）。
         * ここで buildPagePayload が **例外を投げる**ことがある（生成器が未対応の列を持つブランド）。
         * その場合も「状況は前回と同じ」なので静かに見送る。
         * 以前は例外が自動同期全体を巻き込み、ページごとの判定が壊れていた。
         */
        let sameAsLast = false;
        try {
          const { payloadHash } = await buildPagePayload(pageId);
          sameAsLast = payloadHash === lastLog!.payloadHash;
        } catch {
          sameAsLast = true; // 生成できない＝前回と同じ結果になるだけなので通知しない
        }
        if (sameAsLast) continue;
        // 内容が変わっている（コード修正後など）→ 再試行する
      } else if (now - lastEdit < QUIET_MS) {
        continue; // 編集直後は見送り（次の周期で拾う）
      }

      try {
        const res = await syncWpPage(pageId, { dryRun: false, guardThead: true });
        if (res.status === "success") {
          const changed = res.brands.filter((b) => b.changed).map((b) => b.displayName);
          if (changed.length > 0) synced.push(...changed);
        } else if (res.status === "guarded") {
          held.push(`${page.names.join("/")}: ${res.error ?? "列構成不一致"}`);
        } else if (res.status === "failed") {
          failed.push(`${page.names.join("/")}: ${res.error ?? "エラー"}`);
        }
        // skipped（hash同一）は通知不要
      } catch (e) {
        console.error(`価格表の自動同期でエラー (page=${pageId})`, e);
        failed.push(`${page.names.join("/")}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }

    /*
     * 1回の実行につき通知は1通にまとめる（連投防止）。
     * さらに **前回と同じ内容の通知は送らない**。生成器が直るまで保留/失敗が続く状況で、
     * 10分ごとに同じ文面が届くのを防ぐ（実際にそうなって通知が溢れた）。
     * 反映（success）があるときは、内容が同じでも必ず知らせる。
     */
    if (synced.length > 0 || held.length > 0 || failed.length > 0) {
      const lines: string[] = [];
      if (synced.length > 0) lines.push(`✅ 反映: ${synced.join(" / ")}`);
      if (held.length > 0) lines.push(...held.map((h) => `⏸ 保留: ${h}`));
      if (failed.length > 0) lines.push(...failed.map((f) => `❌ 失敗: ${f}`));
      const digest = lines.join("\n");
      if (synced.length === 0 && digest === g.__priceAutoSyncLastDigest) {
        return; // 前回と同じ「保留/失敗だけ」の通知は送らない
      }
      g.__priceAutoSyncLastDigest = digest;
      await notify({
        type: "PRICE_AUTO_SYNC",
        title:
          held.length === 0 && failed.length === 0
            ? "価格表をホームページへ自動反映しました"
            : "価格表の自動反映（要確認あり）",
        message: lines.join("\n"),
        dealerId: null,
        link: "/hq/prices",
      });
    }
  } finally {
    running = false;
  }
}

// サーバー起動時に1回だけ呼ぶ（instrumentation.ts から）。HMR での二重起動を防ぐ。
export function startPriceAutoSync(): void {
  if (g.__priceAutoSyncTimer) return;
  g.__priceAutoSyncTimer = setInterval(() => void runPriceAutoSync(), INTERVAL_MS);
  setTimeout(() => void runPriceAutoSync(), BOOT_DELAY_MS);
  console.log("価格表の自動同期を有効化（10分間隔・列構成ガード付き）");
}
