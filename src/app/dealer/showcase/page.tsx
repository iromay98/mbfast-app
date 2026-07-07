import { requireDealer } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/labels";
import { PageTitle } from "@/components/ui";
import { ShowcaseGallery, type ShowcaseEntry } from "@/components/showcase-gallery";

// 代理店向け施工事例。一般公開＋代理店限定の両方を車両でドリルダウン閲覧。
export default async function DealerShowcasePage() {
  await requireDealer();
  const rows = await prisma.showcase.findMany({
    orderBy: { publishedAt: "desc" },
  });
  const entries: ShowcaseEntry[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    comment: r.comment,
    carMaker: r.carMaker,
    carModel: r.carModel,
    generation: r.generation,
    grade: r.grade,
    stage: r.stage,
    contentLabel: r.contentLabel,
    embeds: r.embeds,
    coverImage: r.coverImage,
    visibility: r.visibility,
    publishedAtLabel: formatDate(r.publishedAt),
  }));

  return (
    <div>
      <PageTitle title="施工事例" subtitle={`${entries.length} 件・車両を選んで閲覧`} />
      <ShowcaseGallery entries={entries} showVisibilityBadge />
    </div>
  );
}
