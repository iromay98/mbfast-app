import { storePerformanceCached } from "@/server/pit/gbp/store-performance";
import { storeArticleStatsCached } from "@/server/pit/article-stats";

/*
 * 店の「見られている実感」カード2枚（サーバーコンポーネント）。
 *  ① Googleでの表示実績（GBP: マップ/検索表示・電話・ルート）
 *  ② mbPITでの記事閲覧（GA4: 閲覧数・読んだ人・人気記事）
 *
 * mbPIT専用アカウントのホーム(/dealer/pit/home)と、代理店ダッシュボード
 * (/dealer)の両方で使う。どちらのロールでも同じ数字が見えるべきで、
 * 片方にしか出ない事故（2026-09-01 Charismで発覚）を部品化で防ぐ。
 * 未連携・未設定・取得失敗は静かに何も出さない（0が並ぶ画面は逆効果）。
 */
export async function StoreInsights({ storeId }: { storeId: string }) {
  const [perf, articleStats] = await Promise.all([
    storePerformanceCached(storeId),
    storeArticleStatsCached(storeId),
  ]);
  if (!perf && !articleStats) return null;

  const get = (kw: string) =>
    (perf ?? []).filter((r) => r.label.includes(kw)).reduce((a, r) => a + r.total, 0);
  const gbpItems = [
    { label: "マップ表示", v: get("マップ表示") },
    { label: "検索表示", v: get("検索表示") },
    { label: "電話", v: get("電話") },
    { label: "ルート検索", v: get("ルート") },
  ];

  return (
    <>
      {perf && (
        <div className="rounded-xl border border-line bg-surface p-3">
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-bold text-ink">Googleでの表示実績</p>
            <p className="text-[10px] text-ink-soft">直近30日・数日遅れで反映</p>
          </div>
          <div className="mt-2 grid grid-cols-4 gap-1.5">
            {gbpItems.map((it) => (
              <div key={it.label} className="rounded-lg bg-paper px-1 py-2 text-center">
                <p className="text-base font-black leading-none text-ink">
                  {it.v.toLocaleString()}
                </p>
                <p className="mt-1 text-[10px] text-ink-soft">{it.label}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {articleStats && (
        <div className="rounded-xl border border-line bg-surface p-3">
          <div className="flex items-baseline justify-between">
            <p className="text-sm font-bold text-ink">mbPITでの記事閲覧</p>
            <p className="text-[10px] text-ink-soft">直近30日</p>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-1.5">
            <div className="rounded-lg bg-paper px-1 py-2 text-center">
              <p className="text-base font-black leading-none text-ink">
                {articleStats.views.toLocaleString()}
              </p>
              <p className="mt-1 text-[10px] text-ink-soft">閲覧数</p>
            </div>
            <div className="rounded-lg bg-paper px-1 py-2 text-center">
              <p className="text-base font-black leading-none text-ink">
                {articleStats.users.toLocaleString()}
              </p>
              <p className="mt-1 text-[10px] text-ink-soft">読んだ人</p>
            </div>
          </div>
          {articleStats.top.length > 0 && (
            <div className="mt-2">
              <p className="text-[10px] font-bold text-ink-soft">よく読まれている記事</p>
              <ul className="mt-1 space-y-0.5">
                {articleStats.top.map((t) => (
                  <li
                    key={t.title}
                    className="flex items-baseline justify-between gap-2 text-[11px]"
                  >
                    <span className="truncate text-ink">{t.title}</span>
                    <span className="shrink-0 text-ink-soft">{t.views}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </>
  );
}
