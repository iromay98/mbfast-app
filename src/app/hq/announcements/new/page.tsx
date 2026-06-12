import { requireHQ } from "@/lib/authz";
import { PageTitle, LinkButton } from "@/components/ui";
import { createAnnouncement } from "@/lib/actions/announcements";
import { AnnouncementForm } from "../announcement-form";

export default async function NewAnnouncementPage() {
  await requireHQ();
  return (
    <div>
      <PageTitle
        title="お知らせの新規作成"
        action={
          <LinkButton href="/hq/announcements" variant="secondary">
            一覧へ戻る
          </LinkButton>
        }
      />
      <AnnouncementForm action={createAnnouncement} submitLabel="公開する" />
    </div>
  );
}
