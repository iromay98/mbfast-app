import { requireDealer } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { formatDate } from "@/lib/labels";
import { PageTitle, LinkButton } from "@/components/ui";
import { RequestTable, type RequestRow } from "@/components/request-table";

export default async function DealerRequestsPage() {
  const user = await requireDealer();
  const requests = await prisma.fileRequest.findMany({
    where: { dealerId: user.dealerId },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      title: true,
      requestNote: true,
      status: true,
      resultFilePath: true,
      carInfo: true,
      updatedAt: true,
      serviceRecord: { select: { carMaker: true, carModel: true, customerName: true } },
    },
  });

  const rows: RequestRow[] = requests.map((r) => ({
    id: r.id,
    customer: r.serviceRecord?.customerName ?? null,
    car:
      `${r.serviceRecord?.carMaker ?? ""} ${r.serviceRecord?.carModel ?? ""}`.trim() ||
      (r.carInfo ?? ""),
    title: r.title,
    content: r.requestNote?.match(/「(.+?)」/)?.[1] ?? null,
    status: r.status,
    autoDelivered: r.status === "DELIVERED" && !r.resultFilePath,
    updatedAtLabel: formatDate(r.updatedAt),
  }));

  return (
    <div>
      <PageTitle
        title="作業依頼"
        subtitle={`${requests.length} 件`}
        action={<LinkButton href="/dealer/requests/new">＋ 新規依頼</LinkButton>}
      />
      <RequestTable rows={rows} forHQ={false} hrefBase="/dealer/requests" />
    </div>
  );
}
