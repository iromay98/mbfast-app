import Link from "next/link";
import { requireDealer } from "@/lib/authz";
import { prisma } from "@/lib/db";
import {
  announcementCategoryLabels,
  announcementCategoryColors,
  formatDate,
} from "@/lib/labels";
import { PageTitle, Card, Badge, EmptyState } from "@/components/ui";

export default async function DealerAnnouncementsPage() {
  const user = await requireDealer();
  const announcements = await prisma.announcement.findMany({
    orderBy: { publishedAt: "desc" },
    include: { reads: { where: { dealerId: user.dealerId }, select: { readAt: true } } },
  });

  return (
    <div>
      <PageTitle title="お知らせ" subtitle={`${announcements.length} 件`} />

      {announcements.length === 0 ? (
        <EmptyState message="お知らせはありません。" />
      ) : (
        <Card className="divide-y divide-line p-0">
          {announcements.map((a) => {
            const isRead = a.reads.length > 0;
            return (
              <Link
                key={a.id}
                href={`/dealer/announcements/${a.id}`}
                className="block p-3 hover:bg-surface-2"
              >
                <div className="flex items-center gap-2">
                  <Badge color={announcementCategoryColors[a.category]}>
                    {announcementCategoryLabels[a.category]}
                  </Badge>
                  <span className="text-xs text-ink-soft">{formatDate(a.publishedAt)}</span>
                  {!isRead && <Badge color="red">未読</Badge>}
                </div>
                <div
                  className={`mt-1 truncate text-sm ${
                    isRead ? "font-medium text-ink" : "font-bold text-ink"
                  }`}
                >
                  {a.title}
                </div>
              </Link>
            );
          })}
        </Card>
      )}
    </div>
  );
}
