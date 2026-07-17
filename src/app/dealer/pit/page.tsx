import { requireDealer } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { Card, PageTitle, EmptyState, Badge } from "@/components/ui";
import { PIT_CATEGORY_LABELS, PIT_STATUS_LABELS } from "@/lib/pit-labels";
import { PitPostForm } from "./pit-post-form";

export const dynamic = "force-dynamic";

// mbPIT 施工ブログ投稿画面（店舗向け）。
// 「写真を送ったら数分で記事になる」体験を最優先に、入力は写真＋車種＋カテゴリの最小限。
export default async function DealerPitPage() {
  const user = await requireDealer();
  const store = await prisma.pitStore.findUnique({ where: { dealerId: user.dealerId } });

  if (!store || !store.active) {
    return (
      <div>
        <PageTitle title="施工ブログ" subtitle="施工記録の自動ブログ公開" />
        <EmptyState message="この店舗では施工ブログ投稿がまだ有効になっていません。本部にお問い合わせください。" />
      </div>
    );
  }

  const recent = await prisma.pitPost.findMany({
    where: { dealerId: user.dealerId },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      vehicle: true,
      category: true,
      status: true,
      publishedUrl: true,
      title: true,
      createdAt: true,
    },
  });

  const statusColor = (s: string) =>
    s === "PUBLISHED" ? "green" : s === "PROCESSING" ? "blue" : s === "HELD" ? "amber" : "red";

  return (
    <div className="space-y-4">
      <PageTitle
        title="施工ブログ"
        subtitle={`写真とメモを送ると、${store.displayName} の施工記事として mbfasttuning.com に自動公開されます`}
      />
      <PitPostForm />

      <Card>
        <h2 className="mb-3 text-sm font-bold text-ink">最近の投稿</h2>
        {recent.length === 0 ? (
          <p className="text-sm text-ink-soft">まだ投稿がありません。</p>
        ) : (
          <ul className="divide-y divide-line">
            {recent.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">
                    {p.title ?? `${p.vehicle}（${PIT_CATEGORY_LABELS[p.category]}）`}
                  </p>
                  <p className="text-xs text-ink-soft">
                    {new Date(p.createdAt).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" })}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Badge color={statusColor(p.status)}>{PIT_STATUS_LABELS[p.status]}</Badge>
                  {p.publishedUrl && (
                    <a
                      href={p.publishedUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-semibold text-gold-600 underline"
                    >
                      記事を見る
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
