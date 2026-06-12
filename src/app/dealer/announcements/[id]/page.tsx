import { notFound } from "next/navigation";
import { requireDealer } from "@/lib/authz";
import { prisma } from "@/lib/db";
import {
  announcementCategoryLabels,
  announcementCategoryColors,
  formatDate,
} from "@/lib/labels";
import { PageTitle, Card, Badge, LinkButton } from "@/components/ui";
import { Markdown } from "@/components/markdown";
import { MarkRead } from "../mark-read";

export default async function DealerAnnouncementDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireDealer();
  const { id } = await params;
  const announcement = await prisma.announcement.findUnique({ where: { id } });
  if (!announcement) notFound();

  return (
    <div>
      <PageTitle
        title="お知らせ"
        action={
          <LinkButton href="/dealer/announcements" variant="secondary">
            一覧へ戻る
          </LinkButton>
        }
      />
      <Card>
        <div className="mb-2 flex items-center gap-2">
          <Badge color={announcementCategoryColors[announcement.category]}>
            {announcementCategoryLabels[announcement.category]}
          </Badge>
          <span className="text-xs text-ink-soft">
            {formatDate(announcement.publishedAt)}
          </span>
        </div>
        <h2 className="mb-3 text-base font-bold text-ink">{announcement.title}</h2>
        <Markdown>{announcement.body}</Markdown>
      </Card>

      {/* 表示で既読化 */}
      <MarkRead announcementId={announcement.id} />
    </div>
  );
}
