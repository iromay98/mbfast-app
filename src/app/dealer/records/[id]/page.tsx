import Link from "next/link";
import { notFound } from "next/navigation";
import { requireDealer } from "@/lib/authz";
import { prisma } from "@/lib/db";
import {
  isPendingStatus,
  requestStatusLabels,
  requestStatusColors,
  formatDate,
} from "@/lib/labels";
import { PageTitle, Card, Badge, LinkButton } from "@/components/ui";
import { RecordDetail } from "@/components/record-detail";
import { AutoRefresh } from "@/components/auto-refresh";
import { RetryDecryptButton } from "@/components/retry-decrypt-button";
import { updateRecordSupplement } from "@/lib/actions/records";
import { SupplementForm } from "./supplement-form";
import { TuningConfigurator } from "./tuning-configurator";
import { RecordTicketForm } from "./record-ticket-form";
import { fuelKindOf, optionTagsFor, popsAllowed, stageRank, baselineStages } from "@/lib/catalog/options";

export default async function DealerRecordDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireDealer();
  const { id } = await params;

  const record = await prisma.serviceRecord.findUnique({ where: { id } });
  if (!record || record.dealerId !== user.dealerId) notFound();

  const supplementAction = updateRecordSupplement.bind(null, record.id);

  // 照合一致した BaseFile の施工メニュー（コンフィギュレータ用）。
  // 1行ずつ全通りは出さず、ステージ＋OP を選ばせて1構成だけ判定する。
  // 提示するステージは本店カタログ(廃止以外)に沿う。OP/バブリングは燃料で決まる。
  const matched = record.matchedBaseFileId
    ? await prisma.baseFile.findUnique({
        where: { id: record.matchedBaseFileId },
        select: {
          fuel: true,
          manufacturer: true,
          variants: {
            where: { status: { not: "DISABLED" } },
            select: { stage: true },
          },
        },
      })
    : null;
  let configurator: {
    stages: { value: string; label: string }[];
    showPops: boolean;
    optionTags: string[];
  } | null = null;
  if (matched) {
    const fuelKind = fuelKindOf(matched.fuel);
    // 基本ステージ（ベンツは Stage1.5 も）＋カタログに存在するステージ（重複排除・並び順）。
    const stageSet = new Set<string>(baselineStages(matched.manufacturer));
    for (const v of matched.variants) stageSet.add((v.stage ?? "").trim());
    const stages = [...stageSet]
      .sort((a, b) => stageRank(a) - stageRank(b) || a.localeCompare(b))
      .map((s) => ({ value: s, label: s || "チューニングなし" }));
    configurator = {
      stages,
      showPops: popsAllowed(fuelKind),
      optionTags: optionTagsFor(fuelKind),
    };
  }
  // この記録に紐づく作業依頼（依頼は記録内に表示。専門情報は含めない）
  const requests = await prisma.fileRequest.findMany({
    where: { serviceRecordId: id, dealerId: user.dealerId },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, status: true, createdAt: true, resultFilePath: true },
  });
  // 納品ファイル(.slave)を配信できるか（その車固有の再暗号化IDが揃っているか）
  const canDeliver =
    !!record.autotunerSlaveId &&
    record.autotunerEcuId != null &&
    record.autotunerModelId != null &&
    !!record.autotunerMcuId;

  // 代理店クライアントへは専門情報(Cal/HW/SW/ecuIdRaw・TCU・適用マップ・本店メモ等)を一切渡さない。
  // フォームが実際に使う項目だけを明示的に渡す（プロップス経由の漏洩防止）。
  const supplementDefaults = {
    vin: record.vin,
    workType: record.workType,
    carYear: record.carYear,
    note: record.note,
    customerName: record.customerName,
    registrationNumber: record.registrationNumber,
    vehicleModelCode: record.vehicleModelCode,
    engineModelCode: record.engineModelCode,
    modelDesignationNumber: record.modelDesignationNumber,
    firstRegistration: record.firstRegistration,
    inspectionExpiry: record.inspectionExpiry,
  };

  return (
    <div className="space-y-4">
      <PageTitle
        title="施工記録の詳細"
        action={
          <LinkButton href="/dealer/records" variant="secondary">
            一覧へ戻る
          </LinkButton>
        }
      />

      {/* 解析中は自動更新 */}
      <AutoRefresh active={isPendingStatus(record.status)} />

      {/* 代理店には専門情報(ECU/Cal/HW/SW・復号ファイル等)を出さない */}
      <RecordDetail record={record} hideTechnical />

      {configurator && (
        <Card className="border-gold-200 bg-gold-50">
          <h3 className="mb-1 text-sm font-bold text-ink">適合チューニング済みファイル</h3>
          <p className="mb-3 text-xs text-ink-soft">
            施工内容（ステージ・バブリング・O2 等）を選ぶと、その場でダウンロードできるか、
            本店へのリクエストになるかを判定します。
          </p>
          <TuningConfigurator
            recordId={record.id}
            stages={configurator.stages}
            showPops={configurator.showPops}
            optionTags={configurator.optionTags}
          />
        </Card>
      )}

      <Card>
        <h3 className="mb-2 text-sm font-bold text-ink">この記録の依頼・相談</h3>
        {requests.length > 0 && (
          <div className="mb-3 divide-y divide-line">
            {requests.map((req) => (
              <div key={req.id} className="flex items-center justify-between gap-3 py-2">
                <Link href={`/dealer/requests/${req.id}`} className="min-w-0 flex-1 hover:underline">
                  <div className="truncate text-sm font-medium text-ink">{req.title}</div>
                  <div className="mt-0.5 text-xs text-ink-soft">{formatDate(req.createdAt)}</div>
                </Link>
                <div className="flex shrink-0 items-center gap-2">
                  {req.status === "DELIVERED" && req.resultFilePath && canDeliver && (
                    <a
                      href={`/api/requests/${req.id}/slave`}
                      download
                      className="rounded-lg bg-gold-500 px-3 py-1.5 text-xs font-semibold text-white"
                    >
                      .slave をダウンロード
                    </a>
                  )}
                  <Badge color={requestStatusColors[req.status]}>
                    {requestStatusLabels[req.status]}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
        {/* 配信後の調整・現車合わせ（ログ反映）のリクエスト */}
        <RecordTicketForm recordId={record.id} />
      </Card>

      {record.status === "FAILED" && (
        <Card className="border-red-200 bg-red-50">
          <p className="mb-2 text-sm text-red-700">
            自動復号に失敗しました。スレーブやネットワークを確認のうえ再解析できます。
          </p>
          <RetryDecryptButton recordId={record.id} />
        </Card>
      )}

      <SupplementForm action={supplementAction} defaults={supplementDefaults} />
    </div>
  );
}
