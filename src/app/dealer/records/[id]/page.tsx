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
import { ServiceLog } from "@/components/service-log";
import { AutoRefresh } from "@/components/auto-refresh";
import { MessageNotifier } from "@/components/message-notifier";
import { RetryDecryptButton } from "@/components/retry-decrypt-button";
import { updateRecordSupplement } from "@/lib/actions/records";
import { SupplementForm } from "./supplement-form";
import { TuningConfigurator } from "./tuning-configurator";
import { SlaveDownloadButton } from "@/components/slave-download-button";
import { fuelKindOf, optionTagsFor, popsAllowed, stageRank, baselineStages, tuningContentLabel } from "@/lib/catalog/options";
import { vehicleLabel } from "@/lib/catalog/vehicle";

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
          model: true,
          generation: true,
          grade: true,
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
    select: {
      id: true,
      authorId: true,
      authorRole: true,
      body: true,
      fileName: true,
      fileSize: true,
      createdAt: true,
      deletedAt: true,
      hqNote: true,
      dealerNote: true,
      redownloadable: true,
      downloadedAt: true,
    },
  });
  // 過去に配布された（この車で実際にDLされた）バリエーション＝再DL可能なもの。
  // キャンセル承諾済みは除外。同じ版は1つにまとめる。
  const pastDownloads = await prisma.catalogDownloadLog.findMany({
    where: { serviceRecordId: id, cancelledAt: null, variantId: { not: null } },
    orderBy: { createdAt: "desc" },
    select: {
      variantId: true,
      createdAt: true,
      variant: {
        select: { id: true, stage: true, popsAndBangs: true, popsSport: true, optionTags: true, status: true, fileRef: true },
      },
    },
  });
  const seenVar = new Set<string>();
  const deliveredVariants = pastDownloads
    .filter((d) => {
      const v = d.variant;
      if (!v || !v.fileRef || v.status !== "AVAILABLE") return false;
      if (seenVar.has(v.id)) return false;
      seenVar.add(v.id);
      return true;
    })
    .map((d) => ({
      variantId: d.variant!.id,
      label: tuningContentLabel(d.variant!.stage, d.variant!.popsAndBangs, d.variant!.optionTags ?? [], d.variant!.popsSport),
      atLabel: formatDate(d.createdAt),
    }));

  const recordActivity = await getRecordActivity(id);
  const serviceLogs = (
    await prisma.serviceLog.findMany({
      where: { serviceRecordId: id },
      orderBy: { performedAt: "desc" },
      select: { id: true, performedAt: true, content: true, note: true },
    })
  ).map((l) => ({
    id: l.id,
    performedAtLabel: formatDate(l.performedAt),
    content: l.content,
    note: l.note,
  }));
  // 納品ファイル(.slave)を配信できるか（その車固有の再暗号化IDが揃っているか）
  const canDeliver =
    !!record.autotunerSlaveId &&
    record.autotunerEcuId != null &&
    record.autotunerModelId != null &&
    !!record.autotunerMcuId;
  // 純正戻しの元データがあるか（純正読み=復号ファイル / チューン済み読み=本店登録のori）
  const hasOri = record.isTuned ? !!record.oriFilePath : !!record.decryptedFilePath;

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
      {/* チャット新着のフォアグラウンド通知 */}
      <MessageNotifier recordId={record.id} viewerRole="DEALER" />

      {/* 代理店には専門情報(ECU/Cal/HW/SW・復号ファイル等)を出さない */}
      <RecordDetail
        record={record}
        hideTechnical
        vehicleName={
          matched
            ? vehicleLabel({
                manufacturer: matched.manufacturer,
                model: matched.model,
                generation: matched.generation,
                grade: matched.grade,
              })
            : undefined
        }
      />

      {/* この車のダウンロード: 純正戻し(ori) と 納品済みの再DL。適合チューニングの上段。 */}
      {canDeliver && (hasOri || deliveredVariants.length > 0) && (
        <Card>
          <h3 className="mb-1 text-sm font-bold text-ink">この車のダウンロード</h3>
          <p className="mb-3 text-xs text-ink-soft">
            純正に戻すファイルと、これまでに納品されたファイルはいつでも再ダウンロードできます（無料）。
          </p>

          {hasOri && (
            <div className="mb-3">
              <div className="mb-1.5 text-xs font-semibold text-ink-soft">純正に戻す（ori）</div>
              <div className="flex flex-wrap gap-2">
                <SlaveDownloadButton
                  href={`/api/records/${record.id}/stock-slave`}
                  label="⬇ 純正(ori) .slave"
                  className="inline-flex items-center rounded-lg border border-gold-300 bg-white px-3 py-2 text-xs font-semibold text-gold-700 hover:bg-gold-50 disabled:opacity-70"
                />
                {/* bak形式（マップスイッチ等でフル書き換えした車の完全復元用） */}
                {!record.isTuned && record.backupSupported && (
                  <SlaveDownloadButton
                    href={`/api/records/${record.id}/stock-slave?mode=backup`}
                    label="⬇ 純正(ori) bak（フル）"
                    className="inline-flex items-center rounded-lg border border-sky-300 bg-white px-3 py-2 text-xs font-semibold text-sky-700 hover:bg-sky-50 disabled:opacity-70"
                  />
                )}
              </div>
            </div>
          )}

          {deliveredVariants.length > 0 && (
            <div>
              <div className="mb-1.5 text-xs font-semibold text-ink-soft">
                納品済みファイル（再ダウンロード）
              </div>
              <div className="divide-y divide-line rounded-lg border border-line">
                {deliveredVariants.map((v) => (
                  <div key={v.variantId} className="flex flex-wrap items-center gap-2 px-3 py-2">
                    <span className="text-xs font-semibold text-ink">{v.label}</span>
                    <span className="text-[11px] text-ink-soft">初回DL {v.atLabel}</span>
                    <SlaveDownloadButton
                      href={`/api/match/${record.id}/variant/${v.variantId}`}
                      label="⬇ 再ダウンロード"
                      className="ml-auto inline-flex items-center rounded-lg bg-gold-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-gold-600 disabled:opacity-70"
                    />
                  </div>
                ))}
              </div>
            </div>
          )}
        </Card>
      )}

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

      {/* 3番目: この案件のやりとり（チャット） */}
      <RecordThread recordId={record.id} messages={messages} viewerRole="DEALER" viewerId={user.id} />

      {/* 4番目: この案件のダウンロード・リクエスト履歴 */}
      <div>
        <h3 className="mb-1 px-1 text-sm font-bold text-ink">この案件のダウンロード・リクエスト履歴</h3>
        <ActivityFeed items={recordActivity} showDealer={false} />
      </div>

      {/* 施工ログ（本部が記録。代理店は閲覧のみ） */}
      <ServiceLog recordId={record.id} logs={serviceLogs} canEdit={false} />

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
                    <SlaveDownloadButton
                      href={`/api/requests/${req.id}/slave`}
                      label=".slave をダウンロード"
                      className="rounded-lg bg-gold-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-70"
                    />
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
