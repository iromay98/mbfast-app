import Link from "next/link";
import { requireHQ } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { dealerStatusLabels } from "@/lib/labels";
import { PageTitle, Card, Badge, EmptyState, LinkButton } from "@/components/ui";

export default async function DealersPage() {
  await requireHQ();
  const dealers = await prisma.dealer.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      _count: { select: { users: true, serviceRecords: true } },
    },
  });

  return (
    <div>
      <PageTitle
        title="代理店管理"
        subtitle={`${dealers.length} 店`}
        action={<LinkButton href="/hq/dealers/new">＋ 新規登録</LinkButton>}
      />

      {dealers.length === 0 ? (
        <EmptyState message="代理店がまだ登録されていません。" />
      ) : (
        <Card className="divide-y divide-line p-0">
          {dealers.map((d) => (
            <Link
              key={d.id}
              href={`/hq/dealers/${d.id}`}
              className="flex items-center justify-between gap-3 p-4 hover:bg-surface-2"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-ink">{d.name}</span>
                  <Badge color={d.status === "ACTIVE" ? "green" : "gray"}>
                    {dealerStatusLabels[d.status]}
                  </Badge>
                </div>
                <div className="mt-0.5 text-xs text-ink-soft">
                  {d.address ?? "住所未登録"}
                </div>
              </div>
              <div className="shrink-0 text-right text-xs text-ink-soft">
                <div>施工 {d._count.serviceRecords} 件</div>
                <div>アカウント {d._count.users}</div>
              </div>
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}
