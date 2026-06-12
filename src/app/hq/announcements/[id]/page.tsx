import { notFound } from "next/navigation";
import { requireHQ } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { PageTitle, Card, LinkButton } from "@/components/ui";
import { Markdown } from "@/components/markdown";
import { updateAnnouncement } from "@/lib/actions/announcements";
import { AnnouncementForm } from "../announcement-form";

export default async function EditAnnouncementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireHQ();
  const { id } = await params;
  const announcement = await prisma.announcement.findUnique({ where: { id } });
  if (!announcement) notFound();

  const action = updateAnnouncement.bind(null, announcement.id);

  return (
    <div className="space-y-5">
      <PageTitle
        title="お知らせの編集"
        action={
          <LinkButton href="/hq/announcements" variant="secondary">
            一覧へ戻る
          </LinkButton>
        }
      />
      <AnnouncementForm action={action} defaults={announcement} submitLabel="変更を保存" />

      <section>
        <h2 className="mb-2 text-sm font-bold text-ink">プレビュー</h2>
        <Card>
          <Markdown>{announcement.body}</Markdown>
        </Card>
      </section>
    </div>
  );
}
