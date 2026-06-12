import Link from "next/link";
import { requireDealer } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { requestStatusLabels, requestStatusColors, formatDate } from "@/lib/labels";
import { PageTitle, Card, Badge, EmptyState, LinkButton } from "@/components/ui";

export default async function DealerRequestsPage() {
  const user = await requireDealer();
  const requests = await prisma.fileRequest.findMany({
    where: { dealerId: user.dealerId },
    orderBy: { updatedAt: "desc" },
  });

  return (
    <div>
      <PageTitle
        title="作業依頼"
        subtitle={`${requests.length} 件`}
        action={<LinkButton href="/dealer/requests/new">＋ 新規依頼</LinkButton>}
      />

      {requests.length === 0 ? (
        <EmptyState message="作業依頼がまだありません。「＋ 新規依頼」から本店へ依頼できます。" />
      ) : (
        <Card className="divide-y divide-line p-0">
          {requests.map((r) => (
            <Link
              key={r.id}
              href={`/dealer/requests/${r.id}`}
              className="flex items-center justify-between gap-3 p-3 hover:bg-surface-2"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-ink">{r.title}</div>
                <div className="mt-0.5 text-xs text-ink-soft">
                  {r.carInfo ?? "—"}・更新 {formatDate(r.updatedAt)}
                </div>
              </div>
              <Badge color={requestStatusColors[r.status]}>
                {requestStatusLabels[r.status]}
              </Badge>
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}
