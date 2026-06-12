import { notFound } from "next/navigation";
import { requireHQ } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { workTypeLabels, formatDate } from "@/lib/labels";
import { PageTitle, Card, LinkButton } from "@/components/ui";
import { RequestInfo } from "@/components/request-info";
import { RequestTimeline } from "@/components/request-timeline";
import { updateRequestByHQ } from "@/lib/actions/requests";
import { HQRequestForm } from "./hq-request-form";

export default async function HQRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireHQ();
  const { id } = await params;

  const request = await prisma.fileRequest.findUnique({
    where: { id },
    include: {
      dealer: { select: { name: true } },
      events: {
        orderBy: { createdAt: "desc" },
        include: { actor: { select: { name: true } } },
      },
    },
  });
  if (!request) notFound();

  // 紐付け候補: 同じ代理店の施工記録
  const records = await prisma.serviceRecord.findMany({
    where: { dealerId: request.dealerId },
    orderBy: { workedAt: "desc" },
    take: 50,
    select: {
      id: true,
      carMaker: true,
      carModel: true,
      vin: true,
      workType: true,
      workedAt: true,
    },
  });
  const recordOptions = records.map((r) => ({
    id: r.id,
    label: `${formatDate(r.workedAt)} ${r.carMaker ?? ""} ${r.carModel ?? ""}${r.workType ? `（${workTypeLabels[r.workType]}）` : ""}`,
  }));

  const action = updateRequestByHQ.bind(null, request.id);

  return (
    <div className="space-y-4">
      <PageTitle
        title="依頼の詳細・処理"
        subtitle={request.dealer.name}
        action={
          <LinkButton href="/hq/requests" variant="secondary">
            一覧へ戻る
          </LinkButton>
        }
      />
      <RequestInfo request={request} />

      <HQRequestForm
        action={action}
        currentStatus={request.status}
        currentHqNote={request.hqNote}
        currentServiceRecordId={request.serviceRecordId}
        recordOptions={recordOptions}
        hasResultFile={!!request.resultFilePath}
      />

      <Card>
        <h3 className="mb-3 text-sm font-bold text-ink">進捗履歴</h3>
        <RequestTimeline events={request.events} />
      </Card>
    </div>
  );
}
