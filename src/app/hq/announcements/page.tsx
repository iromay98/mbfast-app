import Link from "next/link";
import { requireHQ } from "@/lib/authz";
import { prisma } from "@/lib/db";
import {
  announcementCategoryLabels,
  announcementCategoryColors,
  formatDate,
} from "@/lib/labels";
import { PageTitle, Card, Badge, EmptyState, LinkButton } from "@/components/ui";

export default async function HQAnnouncementsPage() {
  await requireHQ();
  const [announcements, dealerCount] = await Promise.all([
    prisma.announcement.findMany({
      orderBy: { publishedAt: "desc" },
      include: { _count: { select: { reads: true } } },
    }),
    prisma.dealer.count(),
  ]);

  return (
    <div>
      <PageTitle
        title="お知らせ配信"
        subtitle={`${announcements.length} 件`}
        action={<LinkButton href="/hq/announcements/new">＋ 新規作成</LinkButton>}
      />

      {announcements.length === 0 ? (
        <EmptyState message="お知らせがまだありません。" />
      ) : (
        <Card className="divide-y divide-line p-0">
          {announcements.map((a) => (
            <Link
              key={a.id}
              href={`/hq/announcements/${a.id}`}
              className="block p-3 hover:bg-surface-2"
            >
              <div className="flex items-center gap-2">
                <Badge color={announcementCategoryColors[a.category]}>
                  {announcementCategoryLabels[a.category]}
                </Badge>
                <span className="text-xs text-ink-soft">{formatDate(a.publishedAt)}</span>
              </div>
              <div className="mt-1 flex items-center justify-between gap-2">
                <span className="truncate text-sm font-medium text-ink">{a.title}</span>
                <span className="shrink-0 text-xs text-ink-soft">
                  既読 {a._count.reads}/{dealerCount}
                </span>
              </div>
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}
