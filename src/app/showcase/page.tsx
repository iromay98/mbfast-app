import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/labels";
import { ShowcaseGallery, type ShowcaseEntry } from "@/components/showcase-gallery";

// 公開ページだが DB を読むためビルド時の静的プリレンダを避け、リクエスト時に描画する。
export const dynamic = "force-dynamic";

export const metadata = {
  title: "施工事例 | mbFAST",
  description: "車両を選んで施工事例（動画・ブログ）をご覧いただけます。",
};

// 一般公開の施工事例（未ログイン可）。PUBLIC のみ。
export default async function PublicShowcasePage() {
  const rows = await prisma.showcase.findMany({
    where: { visibility: "PUBLIC" },
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
      <h1 className="mb-1 text-xl font-bold text-ink">施工事例</h1>
      <p className="mb-5 text-sm text-ink-soft">車両を選んで、動画・ブログでご覧いただけます。</p>
      <ShowcaseGallery entries={entries} />
    </div>
  );
}
