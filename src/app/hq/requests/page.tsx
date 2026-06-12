import Link from "next/link";
import { requireHQ } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { requestStatusLabels, requestStatusColors, formatDate } from "@/lib/labels";
import { PageTitle, Card, Badge, EmptyState, Button, Select, Field } from "@/components/ui";
import type { Prisma } from "@/generated/prisma/client";

type SP = Record<string, string | string[] | undefined>;
function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export default async function HQRequestsPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  await requireHQ();
  const sp = await searchParams;
  const status = one(sp.status);
  const dealerId = one(sp.dealerId);

  const where: Prisma.FileRequestWhereInput = {};
  if (status && status in requestStatusLabels) {
    where.status = status as keyof typeof requestStatusLabels;
  }
  if (dealerId) where.dealerId = dealerId;

  const [dealers, requests] = await Promise.all([
    prisma.dealer.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.fileRequest.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      include: { dealer: { select: { name: true } } },
    }),
  ]);

  return (
    <div>
      <PageTitle title="依頼管理（全店）" subtitle={`${requests.length} 件`} />

      <Card className="mb-4">
        <form method="get" className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="ステータス">
            <Select name="status" defaultValue={status}>
              <option value="">すべて</option>
              {Object.entries(requestStatusLabels).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="代理店">
            <Select name="dealerId" defaultValue={dealerId}>
              <option value="">すべて</option>
              {dealers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex gap-2">
            <Button type="submit">絞り込み</Button>
            <Link
              href="/hq/requests"
              className="inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-semibold text-ink-soft hover:bg-surface-2"
            >
              クリア
            </Link>
          </div>
        </form>
      </Card>

      {requests.length === 0 ? (
        <EmptyState message="該当する依頼がありません。" />
      ) : (
        <Card className="divide-y divide-line p-0">
          {requests.map((r) => (
            <Link
              key={r.id}
              href={`/hq/requests/${r.id}`}
              className="flex items-center justify-between gap-3 p-3 hover:bg-surface-2"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium text-ink">{r.title}</div>
                <div className="mt-0.5 text-xs text-ink-soft">
                  {r.dealer.name}・更新 {formatDate(r.updatedAt)}
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
