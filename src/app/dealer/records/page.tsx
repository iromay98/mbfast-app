import Link from "next/link";
import { requireDealer } from "@/lib/authz";
import { prisma } from "@/lib/db";
import {
  workTypeLabels,
  recordStatusLabels,
  recordStatusColors,
  isPendingStatus,
  formatDate,
} from "@/lib/labels";
import { PageTitle, Card, Badge, EmptyState, LinkButton } from "@/components/ui";
import { AutoRefresh } from "@/components/auto-refresh";
import { vehicleLabel } from "@/lib/catalog/vehicle";
import { SlaveUpload } from "./slave-upload";

export default async function DealerRecordsPage() {
  const user = await requireDealer();
  const records = await prisma.serviceRecord.findMany({
    where: { dealerId: user.dealerId, deletedAt: null },
    orderBy: { createdAt: "desc" },
    include: {
      matchedBaseFile: {
        select: { manufacturer: true, model: true, generation: true, grade: true },
      },
    },
  });

  const hasPending = records.some((r) => isPendingStatus(r.status));

  return (
    <div>
      <PageTitle
        title="施工記録・依頼"
        subtitle={`${records.length} 件`}
        action={
          <LinkButton href="/dealer/records/new" variant="secondary">
            手動で登録
          </LinkButton>
        }
      />

      {/* 解析中の行がある間は自動更新 */}
      <AutoRefresh active={hasPending} />

      <div className="mb-4">
        <SlaveUpload />
      </div>

      {records.length === 0 ? (
        <EmptyState message="施工記録がまだありません。スレーブをアップロードすると自動で作成されます。" />
      ) : (
        <Card className="divide-y divide-line p-0">
          {records.map((r) => {
            const pending = isPendingStatus(r.status);
            const title =
              (r.matchedBaseFile && vehicleLabel(r.matchedBaseFile)) ||
              (r.carMaker || r.carModel
                ? `${r.carMaker ?? ""} ${r.carModel ?? ""}`.trim()
                : r.slaveName || "（解析中…）");
            return (
              <Link
                key={r.id}
                href={`/dealer/records/${r.id}`}
                className="flex items-center justify-between gap-3 p-3 hover:bg-surface-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className={`truncate text-sm font-medium ${pending ? "text-ink-soft" : "text-ink"}`}>
                      {title}
                    </span>
                  </div>
                  <div className="mt-0.5 text-xs text-ink-soft">
                    {r.customerName ? `${r.customerName}・` : ""}
                    {r.vin ? <span className="font-mono">{r.vin}・</span> : null}
                    {formatDate(r.workedAt)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {r.workType && (
                    <Badge color="gold">{workTypeLabels[r.workType]}</Badge>
                  )}
                  <Badge color={recordStatusColors[r.status]}>
                    {recordStatusLabels[r.status]}
                  </Badge>
                </div>
              </Link>
            );
          })}
        </Card>
      )}
    </div>
  );
}
