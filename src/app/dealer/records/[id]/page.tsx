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
import { RecordThread } from "@/components/record-thread";
import { ActivityFeed, getRecordActivity } from "@/components/activity-feed";
import { AutoRefresh } from "@/components/auto-refresh";
import { RetryDecryptButton } from "@/components/retry-decrypt-button";
import { updateRecordSupplement } from "@/lib/actions/records";
import { SupplementForm } from "./supplement-form";
import { TuningConfigurator } from "./tuning-configurator";
import { fuelKindOf, optionTagsFor, popsAllowed, stageRank, baselineStages } from "@/lib/catalog/options";

export default async function DealerRecordDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireDealer();
  const { id } = await params;

  const record = await prisma.serviceRecord.findUnique({ where: { id } });
  if (!record || record.dealerId !== user.dealerId || record.deletedAt) notFound();

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
          limiterCutDisabled: true,
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
    limiterDisabled: boolean;
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
      optionTags: optionTagsFor(fuelKind, matched.manufacturer),
      limiterDisabled: matched.limiterCutDisabled,
    };
  }
  // この記録に紐づく作業依頼（依頼は記録内に表示。専門情報は含めない）
  const requests = await prisma.fileRequest.findMany({
    where: { serviceRecordId: id, dealerId: user.dealerId },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, status: true, createdAt: true, resultFilePath: true },
  });
  const messages = await prisma.recordMessage.findMany({
    where: { serviceRecordId: id },
    orderBy: { createdAt: "asc" },
    select: { id: true, authorRole: true, body: true, fileName: true, createdAt: true },
  });
  const recordActivity = await getRecordActivity(id);
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
            limiterDisabled={configurator.limiterDisabled}
          />
        </Card>
      )}

      {canDeliver && record.decryptedFilePath && (
        <Card>
          <h3 className="mb-1 text-sm font-bold text-ink">純正に戻す（ori）</h3>
          <p className="mb-3 text-xs text-ink-soft">
            アップ時の純正データを、この車用の .slave に暗号化してダウンロードできます。
            チューニングを元に戻したいときにいつでも使えます（無料）。
          </p>
          <a
            href={`/api/records/${record.id}/stock-slave`}
            className="inline-flex items-center rounded-lg border border-gold-300 bg-white px-4 py-2 text-sm font-semibold text-gold-700 hover:bg-gold-50"
          >
            ⬇ 純正(ori) .slave をダウンロード
          </a>
        </Card>
      )}

      {requests.length > 0 && (
        <Card>
          <h3 className="mb-2 text-sm font-bold text-ink">この記録のリクエスト</h3>
          <div className="divide-y divide-line">
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
        </Card>
      )}

      <RecordThread recordId={record.id} messages={messages} viewerRole="DEALER" />

      <div>
        <h3 className="mb-1 px-1 text-sm font-bold text-ink">この案件のダウンロード・リクエスト履歴</h3>
        <ActivityFeed items={recordActivity} showDealer={false} />
      </div>

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
