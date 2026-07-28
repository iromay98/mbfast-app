import Link from "next/link";
import { requireFullDealer } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { currentMonthRange } from "@/lib/dates";
import {
  requestStatusLabels,
  requestStatusColors,
  announcementCategoryLabels,
  announcementCategoryColors,
  formatDate,
} from "@/lib/labels";
import { PageTitle, Card, Badge, EmptyState } from "@/components/ui";
import { StatCard } from "@/components/stat-card";

export default async function DealerDashboard() {
  const user = await requireFullDealer();
  const { start, end } = currentMonthRange();

  const [monthRecords, openRequests, activeRequests, recentAnnouncements, pitStore] =
    await Promise.all([
      prisma.serviceRecord.count({
        where: { dealerId: user.dealerId, workedAt: { gte: start, lt: end }, deletedAt: null },
      }),
      prisma.fileRequest.count({
        where: {
          dealerId: user.dealerId,
          status: { in: ["RECEIVED", "IN_PROGRESS"] },
        },
      }),
      prisma.fileRequest.findMany({
        where: {
          dealerId: user.dealerId,
          status: { in: ["RECEIVED", "IN_PROGRESS", "DELIVERED"] },
        },
        orderBy: { updatedAt: "desc" },
        take: 5,
      }),
      prisma.announcement.findMany({
        orderBy: { publishedAt: "desc" },
        take: 5,
      }),
      prisma.pitStore.findUnique({
        where: { dealerId: user.dealerId },
        select: { active: true },
      }),
    ]);

  return (
    <div>
      <PageTitle title="ダッシュボード" subtitle={user.name ?? "代理店"} />

      <div className="grid grid-cols-2 gap-3">
        <StatCard label="今月の施工件数" value={monthRecords} unit="件" href="/dealer/records" />
        <StatCard
          label="進行中の依頼"
          value={openRequests}
          unit="件"
          href="/dealer/requests"
          accent={openRequests > 0}
        />
      </div>

      {/* スマホ: タブに入っていないメニューへの入り口（加盟店はブログ投稿がタブ化→施工事例をここから） */}
      {pitStore?.active && (
        <div className="mt-3 sm:hidden">
          <Link
            href="/dealer/showcase"
            className="block rounded-lg border border-line bg-surface px-3 py-2.5 text-center text-sm font-semibold text-ink hover:bg-surface-2"
          >
            📷 施工事例を見る
          </Link>
        </div>
      )}

      {/* grid-cols-1(=minmax(0,1fr)) と min-w-0 が無いと、長いタイトルで列幅が画面を突き破り truncate が効かない */}
      <div className="mt-6 grid grid-cols-1 gap-6 sm:grid-cols-2">
        <section className="min-w-0">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-bold text-ink">依頼の進捗</h2>
            <Link href="/dealer/requests" className="text-sm text-gold-600 hover:underline">
              すべて →
            </Link>
          </div>
          {activeRequests.length === 0 ? (
            <EmptyState message="進行中の依頼はありません。" />
          ) : (
            <Card className="divide-y divide-line p-0">
              {activeRequests.map((req) => (
                <Link
                  key={req.id}
                  href={`/dealer/requests/${req.id}`}
                  className="flex items-center justify-between gap-3 p-3 hover:bg-surface-2"
                >
                  <span className="min-w-0 truncate text-sm font-medium text-ink">
                    {req.title}
                  </span>
                  <Badge color={requestStatusColors[req.status]}>
                    {requestStatusLabels[req.status]}
                  </Badge>
                </Link>
              ))}
            </Card>
          )}
        </section>

        <section className="min-w-0">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-bold text-ink">新着お知らせ</h2>
            <Link
              href="/dealer/announcements"
              className="text-sm text-gold-600 hover:underline"
            >
              すべて →
            </Link>
          </div>
          {recentAnnouncements.length === 0 ? (
            <EmptyState message="お知らせはありません。" />
          ) : (
            <Card className="divide-y divide-line p-0">
              {recentAnnouncements.map((a) => (
                <Link
                  key={a.id}
                  href="/dealer/announcements"
                  className="block p-3 hover:bg-surface-2"
                >
                  <div className="flex items-center gap-2">
                    <Badge color={announcementCategoryColors[a.category]}>
                      {announcementCategoryLabels[a.category]}
                    </Badge>
                    <span className="text-xs text-ink-soft">
                      {formatDate(a.publishedAt)}
                    </span>
                  </div>
                  <div className="mt-1 truncate text-sm font-medium text-ink">
                    {a.title}
                  </div>
                </Link>
              ))}
            </Card>
          )}
        </section>
      </div>
    </div>
  );
}
