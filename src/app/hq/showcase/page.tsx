import { requireHQ } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/labels";
import { PageTitle, Card } from "@/components/ui";
import { ShowcaseAdmin, type AdminRow } from "./showcase-admin";

// 本店：施工事例の管理（一覧・公開範囲切替・削除）。作成は施工記録の詳細から。
export default async function HqShowcasePage() {
  await requireHQ();
  const rows = await prisma.showcase.findMany({ orderBy: { publishedAt: "desc" } });
  const adminRows: AdminRow[] = rows.map((r) => ({
    id: r.id,
    title: r.title,
    vehicle: `${r.carMaker} ${r.carModel}${r.generation ? `(${r.generation})` : ""}${r.grade ? ` ${r.grade}` : ""}`.trim(),
    contentLabel: r.contentLabel,
    visibility: r.visibility,
    embeds: r.embeds,
    publishedAtLabel: formatDate(r.publishedAt),
  }));

  return (
    <div>
      <PageTitle title="施工事例の管理" subtitle={`${rows.length} 件`} />
      <Card className="mb-3 border-sky-200 bg-sky-50">
        <p className="text-xs text-sky-800">
          事例は<b>施工記録の詳細ページ</b>の「事例として公開」から作成できます（車両情報を自動で引き継ぎます）。
          動画・ブログ・Instagram等は<b>URLを貼るだけ</b>で、ダウンロードせずリンク/埋め込み表示されます。
        </p>
      </Card>
      <ShowcaseAdmin rows={adminRows} />
    </div>
  );
}
