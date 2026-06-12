import Link from "next/link";
import { requireHQ } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { currentMonthRange } from "@/lib/dates";
import { workTypeLabels, formatDate } from "@/lib/labels";
import { PageTitle, Card, Badge, EmptyState } from "@/components/ui";
import { StatCard } from "@/components/stat-card";

export default async function HQDashboard() {
  await requireHQ();
  const { start, end } = currentMonthRange();

  const [dealerCount, monthRecords, openRequests, recentRecords] =
    await Promise.all([
      prisma.dealer.count({ where: { status: "ACTIVE" } }),
      prisma.serviceRecord.count({ where: { workedAt: { gte: start, lt: end } } }),
      prisma.fileRequest.count({
        where: { status: { in: ["RECEIVED", "IN_PROGRESS"] } },
      }),
      prisma.serviceRecord.findMany({
        orderBy: { createdAt: "desc" },
        take: 8,
        include: { dealer: { select: { name: true } } },
      }),
    ]);

  return (
    <div>
      <PageTitle title="ダッシュボード" subtitle="本店管理者" />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard label="有効な代理店" value={dealerCount} unit="店" href="/hq/dealers" />
        <StatCard label="今月の施工件数" value={monthRecords} unit="件" href="/hq/records" />
        <StatCard
          label="未対応の依頼"
          value={openRequests}
          unit="件"
          href="/hq/requests"
          accent={openRequests > 0}
        />
      </div>

      <div className="mt-6">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-bold text-ink">最近の施工記録</h2>
          <Link href="/hq/records" className="text-sm text-gold-600 hover:underline">
            すべて見る →
          </Link>
        </div>
        {recentRecords.length === 0 ? (
          <EmptyState message="施工記録がまだありません。" />
        ) : (
          <Card className="divide-y divide-line p-0">
            {recentRecords.map((r) => (
              <Link
                key={r.id}
                href={`/hq/records/${r.id}`}
                className="flex items-center justify-between gap-3 p-3 hover:bg-surface-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-ink">
                    {r.carMaker} {r.carModel}
                    <span className="ml-2 font-mono text-xs text-ink-soft">
                      {r.vin}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-ink-soft">
                    {r.dealer.name}・{formatDate(r.workedAt)}
                  </div>
                </div>
                {r.workType && (
                  <Badge color="gold">{workTypeLabels[r.workType]}</Badge>
                )}
              </Link>
            ))}
          </Card>
        )}
      </div>
    </div>
  );
}
