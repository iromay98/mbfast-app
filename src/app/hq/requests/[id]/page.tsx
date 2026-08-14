import { notFound } from "next/navigation";
import { requireHQ } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { workTypeLabels, formatDate } from "@/lib/labels";
import { PageTitle, Card, LinkButton } from "@/components/ui";
import { RequestInfo } from "@/components/request-info";
import { RequestTimeline } from "@/components/request-timeline";
import { updateRequestByHQ } from "@/lib/actions/requests";
import {
  fuelKindOf,
  optionTagsFor,
  popsAllowed,
  baselineStages,
  stageRank,
} from "@/lib/catalog/options";
import { HQRequestForm } from "./hq-request-form";
import { PriorityToggle } from "@/components/priority-toggle";

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
    where: { dealerId: request.dealerId, deletedAt: null },
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

  /*
   * 「リクエストと異なる仕様」で納品するときに、内容を手打ちせず選べるようにするための選択肢。
   * 紐づいた施工記録の純正(BaseFile)から、代理店のコンフィギュレータと**同じ規則**で作る
   * （燃料・メーカー・ユニットで出し分け＝選べるのに登録できない組み合わせを作らない）。
   * 記録が未紐付けのときは選択肢を出さない（そもそも自動登録できないため備考のみ）。
   */
  let deliverChoices: {
    stages: { value: string; label: string }[];
    showPops: boolean;
    optionTags: string[];
  } | null = null;
  if (request.serviceRecordId) {
    const rec = await prisma.serviceRecord.findUnique({
      where: { id: request.serviceRecordId },
      select: {
        matchedBaseFile: {
          select: {
            fuel: true,
            manufacturer: true,
            unit: true,
            variants: { where: { status: { not: "DISABLED" } }, select: { stage: true } },
          },
        },
      },
    });
    const base = rec?.matchedBaseFile;
    if (base) {
      const fuelKind = fuelKindOf(base.fuel);
      const stageSet = new Set<string>(baselineStages(base.manufacturer, base.unit));
      for (const v of base.variants) stageSet.add((v.stage ?? "").trim());
      deliverChoices = {
        stages: [...stageSet]
          .sort((a, b) => stageRank(a) - stageRank(b) || a.localeCompare(b))
          .map((s) => ({ value: s, label: s || "チューニングなし" })),
        showPops: popsAllowed(fuelKind, base.unit),
        optionTags: optionTagsFor(fuelKind, base.manufacturer, base.unit),
      };
    }
  }

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
      {/*
        重要（★）の切り替え。一覧の行にもあるが、詳細を開いて処理しながら立てたい場面が多いので
        ここにも置く（一覧に戻ってから押し直させない）。本店だけの印で代理店には見せない。
      */}
      <Card className={request.priority ? "border-rose-300 bg-rose-50" : ""}>
        <div className="flex items-center gap-2">
          <PriorityToggle requestId={request.id} priority={request.priority} size="md" />
          <div>
            <p className="text-sm font-bold text-ink">
              {request.priority ? "重要（一覧の最上位に固定中）" : "重要にする"}
            </p>
            <p className="text-xs text-ink-soft">
              急ぎ・トラブル対応の見落としを防ぐための印です。代理店には表示されません。
            </p>
          </div>
        </div>
      </Card>

      <RequestInfo request={request} />

      <HQRequestForm
        action={action}
        currentStatus={request.status}
        currentHqNote={request.hqNote}
        currentServiceRecordId={request.serviceRecordId}
        recordOptions={recordOptions}
        hasResultFile={!!request.resultFilePath}
        requestedLabel={request.requestNote?.match(/「(.+?)」/)?.[1] ?? null}
        deliverChoices={deliverChoices}
      />

      <Card>
        <h3 className="mb-3 text-sm font-bold text-ink">進捗履歴</h3>
        <RequestTimeline events={request.events} />
      </Card>
    </div>
  );
}
