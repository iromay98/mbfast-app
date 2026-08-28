/*
 * Googleビジネスプロフィールのパフォーマンス指標（Business Profile Performance API）。
 *
 * 「マップ・検索で何回表示されたか」「電話が何回タップされたか」を取得する。
 * mbPITにとっての意味: 投稿を自動で流した結果が数字で見える＝掲載効果の証明。
 * 月額を払い続ける理由をレポートで示すための土台。
 *
 * 制約（Google側の仕様）:
 * - データは**数日遅れ**で反映される。リアルタイムではなく傾向を見る用途
 * - 遡れるのは18ヶ月まで
 * - Cloud Consoleで「Business Profile Performance API」の有効化が必要。
 *   未有効だと403が返る（呼び出し側でその旨を案内する）
 */
import { gbpFetch } from "@/server/pit/gbp/client";

const PERF_HOST = "https://businessprofileperformance.googleapis.com/v1";

/** 取得する指標。キーはAPIの名称、値は画面表示名 */
export const PERF_METRICS = {
  BUSINESS_IMPRESSIONS_DESKTOP_MAPS: "マップ表示（PC）",
  BUSINESS_IMPRESSIONS_MOBILE_MAPS: "マップ表示（スマホ）",
  BUSINESS_IMPRESSIONS_DESKTOP_SEARCH: "検索表示（PC）",
  BUSINESS_IMPRESSIONS_MOBILE_SEARCH: "検索表示（スマホ）",
  CALL_CLICKS: "電話タップ",
  WEBSITE_CLICKS: "サイトクリック",
  BUSINESS_DIRECTION_REQUESTS: "ルート検索",
} as const;

export type PerfSummary = {
  metric: keyof typeof PERF_METRICS;
  label: string;
  total: number;
};

type ApiResponse = {
  multiDailyMetricTimeSeries?: {
    dailyMetricTimeSeries?: {
      dailyMetric?: string;
      timeSeries?: { datedValues?: { value?: string | number }[] };
    }[];
  }[];
};

function ymd(d: Date): { year: number; month: number; day: number } {
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

/**
 * 直近 daysBack 日の指標合計を取得する。
 * token は方式B（店舗自身の連携）用。未指定なら本部のトークン。
 */
export async function fetchPerformanceSummary(
  locationId: string,
  daysBack = 30,
  token?: string,
): Promise<PerfSummary[]> {
  const loc = locationId.startsWith("locations/") ? locationId : `locations/${locationId}`;
  // データ反映が数日遅れるため、終端は3日前に置く（0埋めの日を集計に混ぜない）
  const end = new Date(Date.now() - 3 * 86400e3);
  const start = new Date(end.getTime() - daysBack * 86400e3);
  const s = ymd(start);
  const e = ymd(end);

  const q = new URLSearchParams();
  for (const m of Object.keys(PERF_METRICS)) q.append("dailyMetrics", m);
  q.set("dailyRange.startDate.year", String(s.year));
  q.set("dailyRange.startDate.month", String(s.month));
  q.set("dailyRange.startDate.day", String(s.day));
  q.set("dailyRange.endDate.year", String(e.year));
  q.set("dailyRange.endDate.month", String(e.month));
  q.set("dailyRange.endDate.day", String(e.day));

  const json = await gbpFetch<ApiResponse>(
    `${PERF_HOST}/${loc}:fetchMultiDailyMetricsTimeSeries?${q}`,
    token ? { token } : undefined,
  );

  // 指標→合計へ畳む（並び順は PERF_METRICS の定義順で安定させる）
  const totals = new Map<string, number>();
  for (const multi of json.multiDailyMetricTimeSeries ?? []) {
    for (const series of multi.dailyMetricTimeSeries ?? []) {
      const metric = series.dailyMetric;
      if (!metric) continue;
      let sum = 0;
      for (const dv of series.timeSeries?.datedValues ?? []) sum += Number(dv.value ?? 0);
      totals.set(metric, (totals.get(metric) ?? 0) + sum);
    }
  }
  return (Object.keys(PERF_METRICS) as (keyof typeof PERF_METRICS)[]).map((m) => ({
    metric: m,
    label: PERF_METRICS[m],
    total: totals.get(m) ?? 0,
  }));
}
