// mbPIT ゲーミフィケーション: 通算/今月件数・週ストリーク・バッジ・先月比較・月間順位。
// カウンタ列は持たず毎回集計（投稿頻度は低いので十分速い。バッチ不要＝週またぎのストリーク
// リセットも参照時計算で自然に反映される）。

import { prisma } from "@/lib/db";
import { notify } from "@/server/notifications";

export const BADGES: { at: number; name: string; emoji: string }[] = [
  { at: 100, name: "マイスター", emoji: "👑" },
  { at: 50, name: "ゴールド", emoji: "🥇" },
  { at: 30, name: "シルバー", emoji: "🥈" },
  { at: 10, name: "ブロンズ", emoji: "🥉" },
];

export type PitStats = {
  total: number;
  month: number;
  lastMonth: number;
  streakWeeks: number;
  badge: { name: string; emoji: string } | null;
  next: { name: string; remaining: number } | null; // 次の称号まで
  rank: number | null; // 今月の投稿数順位（副次表示用）
  storeCount: number;
};

// JST基準の週番号（月曜始まり）。エポックからの通し番号にして連続判定に使う
function jstWeekIndex(d: Date): number {
  const jst = new Date(d.getTime() + 9 * 3600 * 1000);
  const days = Math.floor(jst.getTime() / 86400000);
  return Math.floor((days + 3) / 7); // 1970-01-01(木)基準の補正で月曜始まり
}

function jstMonthStart(offsetMonths = 0): Date {
  const now = new Date(Date.now() + 9 * 3600 * 1000);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + offsetMonths, 1));
  return new Date(d.getTime() - 9 * 3600 * 1000); // JST月初 → UTC
}

export function badgeForTotal(total: number): { name: string; emoji: string } | null {
  const b = BADGES.find((b) => total >= b.at);
  return b ? { name: b.name, emoji: b.emoji } : null;
}

export async function storeStats(storeId: string): Promise<PitStats> {
  const monthStart = jstMonthStart(0);
  const lastMonthStart = jstMonthStart(-1);

  const [total, month, lastMonth, recent, monthByStore] = await Promise.all([
    prisma.pitPost.count({ where: { storeId, status: "published" } }),
    prisma.pitPost.count({ where: { storeId, status: "published", createdAt: { gte: monthStart } } }),
    prisma.pitPost.count({
      where: { storeId, status: "published", createdAt: { gte: lastMonthStart, lt: monthStart } },
    }),
    prisma.pitPost.findMany({
      where: { storeId, status: "published" },
      orderBy: { createdAt: "desc" },
      take: 300,
      select: { createdAt: true },
    }),
    prisma.pitPost.groupBy({
      by: ["storeId"],
      where: { status: "published", createdAt: { gte: monthStart } },
      _count: { _all: true },
    }),
  ]);

  // 週ストリーク: 今週（未投稿でもまだ途切れ扱いにしない）または先週から、連続して投稿がある週数
  const weeks = [...new Set(recent.map((p) => jstWeekIndex(p.createdAt)))].sort((a, b) => b - a);
  const thisWeek = jstWeekIndex(new Date());
  let streak = 0;
  if (weeks.length > 0 && (weeks[0] === thisWeek || weeks[0] === thisWeek - 1)) {
    streak = 1;
    for (let i = 1; i < weeks.length; i++) {
      if (weeks[i] === weeks[i - 1] - 1) streak++;
      else break;
    }
  }

  const badge = badgeForTotal(total);
  const nextBadge = [...BADGES].reverse().find((b) => total < b.at);

  // 今月順位（同数は同順位扱いにせず単純比較で十分）
  const sorted = monthByStore.map((g) => ({ storeId: g.storeId, n: g._count._all })).sort((a, b) => b.n - a.n);
  const rankIdx = sorted.findIndex((s) => s.storeId === storeId);

  return {
    total,
    month,
    lastMonth,
    streakWeeks: streak,
    badge,
    next: nextBadge ? { name: nextBadge.name, remaining: nextBadge.at - total } : null,
    rank: rankIdx >= 0 ? rankIdx + 1 : null,
    storeCount: sorted.length,
  };
}

// 称号到達チェック（投稿成功直後に呼ぶ）。ちょうど閾値に達したら本部へ通知する
export async function notifyBadgeIfReached(storeId: string, storeName: string, total: number): Promise<void> {
  const hit = BADGES.find((b) => b.at === total);
  if (!hit) return;
  await notify({
    type: "PIT_PUBLISHED",
    title: `🎉 ${storeName} が「${hit.name}」に到達しました`,
    message: `mbPIT通算${total}件目の記録です。お祝いメッセージを送りましょう。`,
    dealerId: null,
    link: "/hq/pit",
  });
}
