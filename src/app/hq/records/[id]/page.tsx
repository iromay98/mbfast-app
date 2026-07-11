import Link from "next/link";
import { notFound } from "next/navigation";
import { requireHQ } from "@/lib/authz";
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
import { updateHqNote } from "@/lib/actions/records";
import { HqNoteForm } from "./hq-note-form";
import { RecordDealerSelect } from "./record-dealer-select";
import { DeleteRecordButton } from "./delete-record-button";
import { RecordCustomerEdit } from "./record-customer-edit";
import { RecordWorkedAtEdit } from "./record-workedat-edit";
import { EcuEditForm } from "./ecu-edit-form";
import { ReidentifyEcuButton } from "./reidentify-ecu-button";
import { RecordTunedEdit } from "./record-tuned-edit";
import { RecordUnitEdit } from "./record-unit-edit";
import { HqEncryptForm } from "./hq-encrypt-form";
import { VariationBuilder } from "./variation-matrix";
import { ShowcaseCreateForm } from "./showcase-create-form";
import { dateLabel } from "@/server/catalog/filename";
import {
  fuelKindOf,
  popsAllowed,
  optionTagsFor,
  tuningContentLabel,
  stageRank,
  baselineStages,
} from "@/lib/catalog/options";
import { swLabel } from "@/lib/catalog/sw";
import { vehicleLabel } from "@/lib/catalog/vehicle";

export default async function HQRecordDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireHQ();
  const { id } = await params;

  const record = await prisma.serviceRecord.findUnique({
    where: { id },
    include: { dealer: { select: { name: true } } },
  });
  if (!record) notFound();

  // 施工代理店の付け替え用の一覧
  const dealers = await prisma.dealer.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true },
  });

  // この案件の依頼（記録に紐づくもの）
  const requests = await prisma.fileRequest.findMany({
    where: { serviceRecordId: id },
    orderBy: { createdAt: "desc" },
    select: { id: true, title: true, status: true, createdAt: true, requestNote: true },
  });
  const messages = await prisma.recordMessage.findMany({
    where: { serviceRecordId: id },
    orderBy: { createdAt: "asc" },
    select: { id: true, authorRole: true, body: true, fileName: true, createdAt: true },
  });
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
  // 未返却リクエストの「内容」ラベル（requestNote の 「…」 を抽出）
  const openLabels = requests
    .filter((r) => r.status !== "DELIVERED" && r.status !== "CANCELLED")
    .map((r) => r.requestNote?.match(/「(.+?)」/)?.[1])
    .filter((x): x is string => !!x);

  // マッチした stock(BaseFile)。カタログ同様にチェック式で版を登録するためのデータ。
  const matched = record.matchedBaseFileId
    ? await prisma.baseFile.findUnique({
        where: { id: record.matchedBaseFileId },
        select: {
          fuel: true,
          manufacturer: true,
          model: true,
          generation: true,
          grade: true,
          swNumber: true,
          swSeq: true,
          variants: {
            select: {
              id: true,
              stage: true,
              popsAndBangs: true,
              popsSport: true,
              optionTags: true,
              status: true,
              fileRef: true,
              fileName: true,
            },
          },
        },
      })
    : null;

  type VRow = {
    variantId: string | null;
    label: string;
    stage: string;
    pops: boolean;
    popsSport: boolean;
    optionTags: string[];
    status: "DRAFT" | "AVAILABLE" | "DISABLED";
    fileName: string | null;
    available: boolean;
    requested: boolean;
  };
  let builderProps: {
    stages: { value: string; label: string }[];
    showPops: boolean;
    optionTags: string[];
    variants: VRow[];
    openLabels: string[];
  } | null = null;
  if (matched) {
    const fuelKind = fuelKindOf(matched.fuel);
    // 既定ステージ（ベンツは Stage1.5 も）＋既存ステージ
    const stageSet = new Set<string>(baselineStages(matched.manufacturer));
    for (const v of matched.variants) stageSet.add((v.stage ?? "").trim());
    const stages = [...stageSet]
      .sort((a, b) => stageRank(a) - stageRank(b) || a.localeCompare(b))
      .map((s) => ({ value: s, label: s || "チューニングなし" }));

    // 既存 variant を内容(label)ごとに集約（重複データは最良の1件に）。
    const byLabel = new Map<string, VRow & { _score: number }>();
    for (const v of matched.variants) {
      const stage = (v.stage ?? "").trim();
      const optionTags = v.optionTags ?? [];
      const label = tuningContentLabel(stage, v.popsAndBangs, optionTags, v.popsSport);
      const available = v.status === "AVAILABLE" && !!v.fileRef;
      const score = (available ? 4 : 0) + (v.status === "AVAILABLE" ? 2 : 0) + (v.fileRef ? 1 : 0);
      const prev = byLabel.get(label);
      if (!prev || score > prev._score) {
        byLabel.set(label, {
          variantId: v.id,
          label,
          stage,
          pops: v.popsAndBangs,
          popsSport: v.popsSport,
          optionTags,
          status: v.status,
          fileName: v.fileName ?? null,
          available,
          requested: openLabels.includes(label),
          _score: score,
        });
      }
    }
    const variants = [...byLabel.values()]
      .sort(
        (a, b) =>
          stageRank(a.stage) - stageRank(b.stage) ||
          Number(a.pops) - Number(b.pops) ||
          a.optionTags.length - b.optionTags.length ||
          a.label.localeCompare(b.label),
      )
      .map(({ _score, ...r }) => r);

    builderProps = {
      stages,
      showPops: popsAllowed(fuelKind),
      optionTags: optionTagsFor(fuelKind, matched.manufacturer),
      variants,
      openLabels,
    };
  }

  return (
    <div className="space-y-3">
      <PageTitle
        title="施工記録の詳細"
        action={
          <LinkButton href="/hq/records" variant="secondary">
            一覧へ戻る
          </LinkButton>
        }
      />

      <AutoRefresh active={isPendingStatus(record.status)} />
      <MessageNotifier recordId={record.id} viewerRole="HQ_ADMIN" />

      <RecordDetail
        record={record}
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
        dealerControl={
          <RecordDealerSelect
            recordId={record.id}
            currentDealerId={record.dealerId}
            dealers={dealers}
          />
        }
        customerNameControl={
          <RecordCustomerEdit recordId={record.id} current={record.customerName} />
        }
        workedAtControl={
          <RecordWorkedAtEdit
            recordId={record.id}
            current={record.workedAt.toISOString().slice(0, 10)}
          />
        }
        swDisplay={
          matched?.swNumber
            ? swLabel(matched.swNumber, matched.swSeq)
            : record.swNumber
              ? swLabel(record.swNumber, 0)
              : undefined
        }
        hideFiles
        ecuControl={
          <div>
            {/* 識別子の手動入力（自動抽出とセット・本店のみ） */}
            <EcuEditForm
              recordId={record.id}
              hw={record.hwNumber}
              sw={record.swNumber}
              cal={record.calNumber}
            />
            {record.decryptedFilePath && (
              <div className="mt-2">
                <ReidentifyEcuButton recordId={record.id} />
              </div>
            )}
          </div>
        }
      />

      {/* この案件の依頼（バリエーションの直上に配置） */}
      {requests.length > 0 && (
        <Card>
          <h3 className="mb-2 text-sm font-bold text-ink">この案件の依頼</h3>
          <div className="divide-y divide-line">
            {requests.map((req) => {
              const label = req.requestNote?.match(/「(.+?)」/)?.[1];
              return (
                <Link
                  key={req.id}
                  href={`/hq/requests/${req.id}`}
                  className="flex items-center justify-between gap-3 py-1.5 hover:bg-surface-2"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {label && (
                        <span className="rounded bg-gold-500 px-1.5 py-0.5 text-[11px] font-bold text-white">
                          {label}
                        </span>
                      )}
                      <span className="truncate text-sm font-medium text-ink">{req.title}</span>
                    </div>
                    <div className="mt-0.5 text-xs text-ink-soft">{formatDate(req.createdAt)}</div>
                  </div>
                  <Badge color={requestStatusColors[req.status]}>
                    {requestStatusLabels[req.status]}
                  </Badge>
                </Link>
              );
            })}
          </div>
        </Card>
      )}

      {/* バリエーション登録（ファイルDL・ファイル区分もここにまとめる） */}
      <Card>
        <h3 className="mb-2 text-sm font-bold text-ink">バリエーション登録</h3>
        {/* ファイル＋ファイル区分（コンパクトな1段） */}
        <div className="mb-3 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg bg-surface-2 px-3 py-2">
          <span className="text-xs font-semibold text-ink-soft">ファイル</span>
          {record.slaveFilePath && (
            <a
              href={`/api/records/${record.id}/files/slave`}
              className="rounded-lg border border-line bg-white px-2.5 py-1 text-xs font-semibold text-ink-soft hover:bg-surface"
            >
              ⬇ slave
            </a>
          )}
          {record.decryptedFilePath ? (
            <a
              href={`/api/records/${record.id}/files/decrypted`}
              className="rounded-lg border border-gold-300 bg-white px-2.5 py-1 text-xs font-semibold text-gold-700 hover:bg-gold-50"
            >
              ⬇ bin
            </a>
          ) : (
            <span className="text-xs text-ink-soft">bin 未生成</span>
          )}
          {/* bak: ECU全内容のフル復号bin（backup対応車のみ・マップスイッチ用） */}
          {record.slaveFilePath && record.backupSupported && (
            <a
              href={`/api/records/${record.id}/files/bak`}
              title="ECU全内容のフル復号bin（mode=backup・マップスイッチ用・初回は数秒かかります）"
              className="rounded-lg border border-sky-300 bg-white px-2.5 py-1 text-xs font-semibold text-sky-700 hover:bg-sky-50"
            >
              ⬇ bak（フル）
            </a>
          )}
          <span className="hidden h-4 w-px bg-line sm:block" />
          <RecordUnitEdit recordId={record.id} unit={record.unit} />
          <RecordTunedEdit recordId={record.id} isTuned={record.isTuned} />
        </div>
        {builderProps ? (
          <VariationBuilder
            recordId={record.id}
            stages={builderProps.stages}
            showPops={builderProps.showPops}
            optionTags={builderProps.optionTags}
            variants={builderProps.variants}
            openLabels={builderProps.openLabels}
          />
        ) : (
          <p className="text-xs text-ink-soft">
            この記録はストック（純正ファイル）に紐づいていないため、バリエーション登録は表示できません。
          </p>
        )}
      </Card>

      <Card>
        <h3 className="mb-1 text-sm font-bold text-ink">本部で encrypt（.slave を焼く）</h3>
        <p className="mb-3 text-xs text-ink-soft">
          外部で作ったチューニング後bin を、この車固有のID で暗号化して焼ける .slave を取得します。
          ファイル名の代理店名・顧客名・日付・車種・Cal は<b>この記録から自動</b>で入ります。
        </p>
        <HqEncryptForm
          recordId={record.id}
          backupSupported={record.backupSupported === true}
          canEncrypt={
            !!record.autotunerSlaveId &&
            record.autotunerEcuId != null &&
            record.autotunerModelId != null &&
            !!record.autotunerMcuId
          }
          showPops={builderProps?.showPops ?? true}
          optionTags={builderProps?.optionTags ?? []}
          namePreview={`${record.dealer?.name ?? ""}(${[record.customerName, dateLabel(record.workedAt)]
            .filter(Boolean)
            .join("+")})`}
        />
      </Card>

      {record.decryptedFilePath &&
        !record.isTuned &&
        !!record.autotunerSlaveId &&
        record.autotunerEcuId != null &&
        record.autotunerModelId != null &&
        !!record.autotunerMcuId && (
          <Card>
            <h3 className="mb-1 text-sm font-bold text-ink">純正に戻す（ori）</h3>
            <p className="mb-3 text-xs text-ink-soft">
              アップ時の純正データを、この車用の .slave に暗号化してダウンロードします（焼ける純正復元ファイル）。
            </p>
            <a
              href={`/api/records/${record.id}/stock-slave`}
              className="inline-flex items-center rounded-lg border border-gold-300 bg-white px-4 py-2 text-sm font-semibold text-gold-700 hover:bg-gold-50"
            >
              ⬇ 純正(ori) .slave をダウンロード
            </a>
          </Card>
        )}

      <RecordThread
        recordId={record.id}
        messages={messages}
        viewerRole="HQ_ADMIN"
        canEncrypt={
          !!record.autotunerSlaveId &&
          record.autotunerEcuId != null &&
          record.autotunerModelId != null &&
          !!record.autotunerMcuId
        }
        backupSupported={record.backupSupported === true}
      />

      <div>
        <h3 className="mb-1 px-1 text-sm font-bold text-ink">この案件のダウンロード・リクエスト履歴</h3>
        <ActivityFeed items={recordActivity} showDealer />
      </div>

      <ServiceLog recordId={record.id} logs={serviceLogs} canEdit />

      <Card>
        <h3 className="mb-1 text-sm font-bold text-ink">施工事例として公開</h3>
        <p className="mb-2 text-xs text-ink-soft">
          動画・ブログ・Instagram等は<b>URLを貼るだけ</b>（DLせずリンク/埋め込み表示）。車両情報は自動で引き継ぎます。
        </p>
        <ShowcaseCreateForm recordId={record.id} />
      </Card>

      <HqNoteForm
        action={updateHqNote.bind(null, record.id)}
        defaultValue={record.hqNote ?? ""}
      />

      {record.status === "FAILED" && (
        <Card className="border-red-200 bg-red-50">
          <p className="mb-2 text-sm text-red-700">
            自動復号に失敗しています。再解析を実行できます。
          </p>
          <RetryDecryptButton recordId={record.id} />
        </Card>
      )}

      {/* 削除（最下部・本店のみ） */}
      <Card className="border-red-200">
        <h3 className="mb-1 text-sm font-bold text-red-700">施工記録の削除（アーカイブ）</h3>
        <p className="mb-3 text-xs text-ink-soft">
          一覧から消えますが<b>アーカイブとして保管</b>され、ファイル・履歴も保持します。
          「メンテナンス」からいつでも復元できます（完全削除もそこから）。
        </p>
        <DeleteRecordButton
          recordId={record.id}
          label={`${record.carMaker ?? ""} ${record.carModel ?? ""}`.trim() || record.id}
        />
      </Card>
    </div>
  );
}
