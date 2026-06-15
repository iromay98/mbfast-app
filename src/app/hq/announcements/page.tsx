import Link from "next/link";
import { requireHQ } from "@/lib/authz";
import { prisma } from "@/lib/db";
import {
  announcementCategoryLabels,
  announcementCategoryColors,
  formatDate,
} from "@/lib/labels";
import { PageTitle, Card, Badge, EmptyState, LinkButton } from "@/components/ui";
import {
  DeleteAnnouncementButton,
  DeleteAllAnnouncementsButton,
} from "./announcement-admin";

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
        action={
          <div className="flex items-center gap-2">
            {announcements.length > 0 && <DeleteAllAnnouncementsButton />}
            <LinkButton href="/hq/announcements/new">＋ 新規作成</LinkButton>
          </div>
        }
      />

      {announcements.length === 0 ? (
        <EmptyState message="お知らせがまだありません。" />
      ) : (
        <Card className="divide-y divide-line p-0">
          {announcements.map((a) => (
            <div key={a.id} className="flex items-center gap-2 p-3 hover:bg-surface-2">
              <Link href={`/hq/announcements/${a.id}`} className="min-w-0 flex-1">
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
              <DeleteAnnouncementButton id={a.id} />
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
