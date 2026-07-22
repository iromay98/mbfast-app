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
import { vehicleLabel, engineNameOf } from "@/lib/catalog/vehicle";
import { SlaveUpload } from "./slave-upload";
import { MasterFileUpload } from "./master-upload";

export default async function DealerRecordsPage() {
  const user = await requireDealer();
  const dealer = await prisma.dealer.findUnique({
    where: { id: user.dealerId },
    select: { fileFormat: true },
  });
  const isMaster = dealer?.fileFormat === "MASTER";
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

  // 本部が用意してくれたファイル（納品済みリクエスト・直近30日）を目立つ場所に出す
  const delivered = await prisma.fileRequest.findMany({
    where: {
      dealerId: user.dealerId,
      status: "DELIVERED",
      updatedAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
    },
    orderBy: { updatedAt: "desc" },
    take: 10,
    select: {
      id: true,
      title: true,
      requestNote: true,
      updatedAt: true,
      serviceRecordId: true,
      serviceRecord: { select: { carMaker: true, carModel: true, customerName: true } },
    },
  });

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

      {/* 本部からの納品（届いたファイル）— 通知を見逃してもここで気づける */}
      {delivered.length > 0 && (
        <Card className="mb-4 border-green-300 bg-green-50">
          <h3 className="mb-2 text-sm font-bold text-green-900">
            📦 本部からファイルが届いています（{delivered.length}）
          </h3>
          <div className="divide-y divide-green-200/70">
            {delivered.map((d) => {
              const label = d.requestNote?.match(/「(.+?)」/)?.[1];
              const car = d.serviceRecord
                ? `${d.serviceRecord.carMaker ?? ""} ${d.serviceRecord.carModel ?? ""}`.trim()
                : "";
              return (
                <Link
                  key={d.id}
                  href={d.serviceRecordId ? `/dealer/records/${d.serviceRecordId}` : `/dealer/requests/${d.id}`}
                  className="flex items-center justify-between gap-3 py-2 hover:bg-green-100/50"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {label && (
                        <span className="rounded bg-green-600 px-1.5 py-0.5 text-[11px] font-bold text-white">
                          {label}
                        </span>
                      )}
                      <span className="truncate text-sm font-medium text-ink">
                        {car || d.title}
                        {d.serviceRecord?.customerName ? `（${d.serviceRecord.customerName}）` : ""}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-green-800">
                      {formatDate(d.updatedAt)}・開いてダウンロードできます
                    </div>
                  </div>
                  <span className="shrink-0 rounded-lg bg-green-600 px-3 py-1.5 text-xs font-bold text-white">
                    ⬇ 受け取る
                  </span>
                </Link>
              );
            })}
          </div>
        </Card>
      )}

      <div className="mb-4">
        {isMaster ? <MasterFileUpload /> : <SlaveUpload />}
      </div>

      {records.length === 0 ? (
        <EmptyState message="施工記録がまだありません。スレーブをアップロードすると自動で作成されます。" />
      ) : (
        <Card className="divide-y divide-line p-0">
          {records.map((r) => {
            const pending = isPendingStatus(r.status);
            const eng = engineNameOf(r.engineInfo);
            const title =
              (r.matchedBaseFile && vehicleLabel(r.matchedBaseFile)) ||
              (r.carMaker || r.carModel
                ? `${r.carMaker ?? ""} ${r.carModel ?? ""}${eng ? ` ${eng}` : ""}`.trim()
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
                  {r.unit === "TCU" && <Badge color="blue">TCU</Badge>}
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
