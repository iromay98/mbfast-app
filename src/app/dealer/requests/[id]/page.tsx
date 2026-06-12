import { notFound } from "next/navigation";
import { requireDealer } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { PageTitle, Card, LinkButton } from "@/components/ui";
import { RequestInfo } from "@/components/request-info";
import { RequestTimeline } from "@/components/request-timeline";

export default async function DealerRequestDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireDealer();
  const { id } = await params;

  const request = await prisma.fileRequest.findUnique({
    where: { id },
    include: {
      events: {
        orderBy: { createdAt: "desc" },
        include: { actor: { select: { name: true } } },
      },
    },
  });
  if (!request || request.dealerId !== user.dealerId) notFound();

  return (
    <div className="space-y-4">
      <PageTitle
        title="作業依頼の詳細"
        action={
          <LinkButton href="/dealer/requests" variant="secondary">
            一覧へ戻る
          </LinkButton>
        }
      />
      <RequestInfo request={request} />
      <Card>
        <h3 className="mb-3 text-sm font-bold text-ink">進捗履歴</h3>
        <RequestTimeline events={request.events} />
      </Card>
    </div>
  );
}
