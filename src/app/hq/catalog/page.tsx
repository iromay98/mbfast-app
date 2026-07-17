import Link from "next/link";
import { requireHQ } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { PageTitle, Card, Button, Input, Select, Field } from "@/components/ui";
import type { Prisma } from "@/generated/prisma/client";
import { CatalogGrid, type CatalogRow, type CalGroup } from "./catalog-grid";
import { StockUploadForm } from "./stock-upload-form";
import { BulkReidentifyButton } from "./bulk-reidentify-button";
import { fuelKindOf, stageRank } from "@/lib/catalog/options";
import { MANUFACTURERS } from "@/lib/catalog/manufacturers";

// Cal(BaseFile)→ステージ→バブリング に階層化
function buildGroups(rows: CatalogRow[]): CalGroup[] {
  const byBase = new Map<string, CatalogRow[]>();
  for (const r of rows) {
    const arr = byBase.get(r.baseFileId) ?? [];
    arr.push(r);
    byBase.set(r.baseFileId, arr);
  }
  const groups: CalGroup[] = [];
  for (const [baseFileId, brows] of byBase) {
    const first = brows[0];
    const byStage = new Map<string, CatalogRow[]>();
    for (const r of brows) {
      const k = r.stage.trim();
      const a = byStage.get(k) ?? [];
      a.push(r);
      byStage.set(k, a);
    }
    const stages = [...byStage.entries()]
      .sort((a, b) => stageRank(a[0]) - stageRank(b[0]) || a[0].localeCompare(b[0]))
      .map(([stage, srows]) => {
        const off: CatalogRow[] = [];
        const on: CatalogRow[] = [];
        for (const r of srows) (r.popsAndBangs ? on : off).push(r);
        // バブリングあり/なし は空でも常に両方の枠を出す（追加導線のため）
        const pops = [
          { pops: false, rows: off },
          { pops: true, rows: on },
        ];
        return { stage, label: stage.trim() || "チューニングなし", pops };
      });
    groups.push({
      baseFileId,
      manufacturer: first.manufacturer,
      model: first.model,
      generation: first.generation,
      grade: first.grade,
      engineCode: first.engineCode,
      displacement: first.displacement,
      ecu: first.ecu,
      cal: first.cal,
      sw: first.sw,
      swSeq: first.swSeq,
      hw: first.hw,
      fuelKind: fuelKindOf(first.fuel),
      hasStock: first.hasStock,
      limiterCutDisabled: first.limiterCutDisabled,
      unit: first.unit,
      tool: first.tool,
      method: first.method,
      substituteKey: first.substituteKey,
      driver: first.baseDriver,
      driverBorrowed: first.baseDriverBorrowed,
      note: first.baseNote,
      count: brows.length,
      stages,
    });
  }
  groups.sort(
    (a, b) =>
      a.manufacturer.localeCompare(b.manufacturer) ||
      a.model.localeCompare(b.model) ||
      a.cal.localeCompare(b.cal),
  );
  return groups;
}

type SP = Record<string, string | string[] | undefined>;
function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

function fmt(d: Date): string {
  // サーバー側で整形（ハイドレーション差異回避）
  const p = (n: number) => String(n).padStart(2, "0");
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}

export default async function HQCatalogPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  await requireHQ();
  const sp = await searchParams;
  const q = one(sp.q).trim();
  const manufacturer = one(sp.manufacturer).trim();
  const unit = one(sp.unit).trim(); // "" | "ECU" | "TCU"
  const ecu = one(sp.ecu).trim();
  const model = one(sp.model).trim();
  const generation = one(sp.generation).trim();
  const stage = one(sp.stage).trim();
  const status = one(sp.status).trim();

  const where: Prisma.TunedVariantWhereInput = { deletedAt: null };
  const baseWhere: Prisma.BaseFileWhereInput = {};
  if (manufacturer) baseWhere.manufacturer = { contains: manufacturer, mode: "insensitive" };
  if (unit === "ECU" || unit === "TCU") baseWhere.unit = unit;
  if (ecu) baseWhere.ecu = { contains: ecu, mode: "insensitive" };
  if (model) baseWhere.model = { contains: model, mode: "insensitive" };
  if (generation) baseWhere.generation = { contains: generation, mode: "insensitive" };
  if (Object.keys(baseWhere).length) where.baseFile = baseWhere;
  if (stage) where.stage = { contains: stage, mode: "insensitive" };
  if (status === "DRAFT" || status === "AVAILABLE" || status === "DISABLED") {
    where.status = status;
  }
  if (q) {
    where.OR = [
      { stage: { contains: q, mode: "insensitive" } },
      { options: { contains: q, mode: "insensitive" } },
      { baseFile: { manufacturer: { contains: q, mode: "insensitive" } } },
      { baseFile: { model: { contains: q, mode: "insensitive" } } },
      { baseFile: { ecu: { contains: q, mode: "insensitive" } } },
    ];
  }

  // 入力補助(datalist)用の既存メーカー/車種
  const [makerRows, modelRows] = await Promise.all([
    prisma.baseFile.findMany({ distinct: ["manufacturer"], select: { manufacturer: true } }),
    prisma.baseFile.findMany({
      distinct: ["model"],
      select: { model: true },
      orderBy: { model: "asc" },
    }),
  ]);
  const makerOptions = makerRows.map((m) => m.manufacturer).filter(Boolean);
  const modelOptions = modelRows.map((m) => m.model).filter(Boolean);
  const makerSuggest = Array.from(new Set([...MANUFACTURERS, ...makerOptions])).sort((a, b) =>
    a.localeCompare(b),
  );

  const [variants, pendingCount] = await Promise.all([
    prisma.tunedVariant.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: 300,
      include: {
        baseFile: true,
        versions: {
          orderBy: { version: "desc" },
          select: { id: true, version: true, fileName: true, fileHash: true, replacedAt: true, label: true, note: true },
        },
      },
    }),
    prisma.baseFile.count({
      where: { archived: false, variants: { none: { status: "AVAILABLE" } } },
    }),
  ]);

  // .slave 化可否: 自動取込元の施工記録に再暗号化用ID(復号時保存)が揃っている純正のみ可。
  const capturedIds = Array.from(
    new Set(
      variants
        .map((v) => v.baseFile.capturedFromRecordId)
        .filter((x): x is string => !!x),
    ),
  );
  const capturedRecs = capturedIds.length
    ? await prisma.serviceRecord.findMany({
        where: { id: { in: capturedIds } },
        select: {
          id: true,
          autotunerSlaveId: true,
          autotunerEcuId: true,
          autotunerModelId: true,
          autotunerMcuId: true,
        },
      })
    : [];
  const slaveReady = new Set(
    capturedRecs
      .filter(
        (r) =>
          !!r.autotunerSlaveId &&
          r.autotunerEcuId != null &&
          r.autotunerModelId != null &&
          !!r.autotunerMcuId,
      )
      .map((r) => r.id),
  );

  const rows: CatalogRow[] = variants.map((v) => ({
    id: v.id,
    baseFileId: v.baseFileId,
    manufacturer: v.baseFile.manufacturer,
    model: v.baseFile.model,
    ecu: v.baseFile.ecu,
    mcu: v.baseFile.mcu ?? "",
    generation: v.baseFile.generation ?? "",
    grade: v.baseFile.grade ?? "",
    engineCode: v.baseFile.engineCode ?? "",
    displacement: v.baseFile.displacement ?? "",
    cal: v.baseFile.calNumber ?? "",
    sw: v.baseFile.swNumber ?? "",
    swSeq: v.baseFile.swSeq ?? 0,
    hw: v.baseFile.hwNumber ?? "",
    fuel: v.baseFile.fuel ?? "",
    stockHash: v.baseFile.stockHash ?? "",
    hasStock: !!v.baseFile.stockFileRef,
    tool: v.baseFile.tool ?? "AT",
    method: v.baseFile.method ?? "",
    substituteKey: v.baseFile.substituteKey ?? "",
    canSlave:
      !!v.baseFile.capturedFromRecordId && slaveReady.has(v.baseFile.capturedFromRecordId),
    limiterCutDisabled: v.baseFile.limiterCutDisabled,
    unit: v.baseFile.unit,
    stage: v.stage,
    popsAndBangs: v.popsAndBangs,
    popsSport: v.popsSport,
    optionTags: v.optionTags ?? [],
    options: v.options ?? "",
    note: v.note ?? "",
    baseDriver: v.baseFile.driver ?? "",
    baseDriverBorrowed: v.baseFile.driverBorrowed,
    baseNote: v.baseFile.note ?? "",
    status: v.status,
    fileName: v.fileName ?? "",
    fileHash: v.fileHash ?? "",
    fileSize: v.fileSize ?? null,
    updatedAtLabel: fmt(v.updatedAt),
    versions: v.versions.map((ver) => ({
      id: ver.id,
      version: ver.version,
      fileName: ver.fileName ?? "",
      fileHash: ver.fileHash ?? "",
      replacedAtLabel: fmt(ver.replacedAt),
      label: ver.label ?? "",
      note: ver.note ?? "",
    })),
  }));

  const groups = buildGroups(rows);

  return (
    <div>
      <PageTitle
        title="チューニング済みファイル・カタログ"
        subtitle={`${rows.length} 件（本店専用）`}
        action={
          <Link
            href="/hq/catalog/pending"
            className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 text-sm font-semibold text-ink-soft hover:bg-surface-2"
          >
            未整備ストック{pendingCount > 0 ? `（${pendingCount}）` : ""}
          </Link>
        }
      />

      {/* このページの主目的＝純正(原本)データのアップロード。これに mod がぶら下がる。 */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <StockUploadForm makerOptions={makerOptions} modelOptions={modelOptions} />
        <BulkReidentifyButton />
      </div>

      {/* ECU / TCU タブ（同時施工の取り違え防止・ファイル区分） */}
      <div className="mb-3 flex flex-wrap gap-2">
        {([["", "すべて"], ["ECU", "ECU（エンジン）"], ["TCU", "TCU（ミッション）"]] as const).map(
          ([v, label]) => {
            const qs = new URLSearchParams();
            if (manufacturer) qs.set("manufacturer", manufacturer);
            if (v) qs.set("unit", v);
            const on = unit === v || (!unit && !v);
            return (
              <Link
                key={v || "all"}
                href={`/hq/catalog${qs.toString() ? `?${qs}` : ""}`}
                className={`rounded-lg px-3 py-1 text-xs font-bold ${
                  on
                    ? v === "TCU"
                      ? "bg-sky-500 text-white"
                      : "bg-gold-500 text-white"
                    : "border border-line text-ink-soft hover:bg-surface-2"
                }`}
              >
                {label}
              </Link>
            );
          },
        )}
      </div>

      {/* メーカーで表示を絞る（全車両ではなくメーカー単位で見やすく） */}
      {makerOptions.length > 1 && (
        <div className="mb-4 flex flex-wrap gap-2">
          <Link
            href={`/hq/catalog${unit ? `?unit=${unit}` : ""}`}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${
              manufacturer
                ? "border border-line text-ink-soft hover:bg-surface-2"
                : "bg-gold-500 text-white"
            }`}
          >
            すべて
          </Link>
          {makerOptions
            .slice()
            .sort((a, b) => a.localeCompare(b))
            .map((m) => (
              <Link
                key={m}
                href={`/hq/catalog?manufacturer=${encodeURIComponent(m)}${unit ? `&unit=${unit}` : ""}`}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  manufacturer === m
                    ? "bg-gold-500 text-white"
                    : "border border-line text-ink-soft hover:bg-surface-2"
                }`}
              >
                {m}
              </Link>
            ))}
        </div>
      )}

      <Card className="mb-4">
        <form method="get" className="space-y-3">
          <Field label="キーワード（メーカー・車種・ECU・ステージ・オプション）">
            <Input name="q" defaultValue={q} placeholder="例: Audi / MED17 / Stage1" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="メーカー">
              <Input
                name="manufacturer"
                defaultValue={manufacturer}
                list="search-maker"
                placeholder="A… → Audi / Abarth / Alpine"
              />
            </Field>
            <Field label="車種">
              <Input name="model" defaultValue={model} list="search-model" placeholder="RS3 / S3" />
            </Field>
            <Field label="世代（補助）">
              <Input name="generation" defaultValue={generation} placeholder="8V" />
            </Field>
            <Field label="ECU">
              <Input name="ecu" defaultValue={ecu} placeholder="Bosch MED17.1.1" />
            </Field>
            <Field label="ステージ">
              <Input name="stage" defaultValue={stage} placeholder="Stage1" />
            </Field>
            <Field label="状態">
              <Select name="status" defaultValue={status}>
                <option value="">すべて</option>
                <option value="DRAFT">下書き</option>
                <option value="AVAILABLE">配布可</option>
                <option value="DISABLED">無効</option>
              </Select>
            </Field>
          </div>
          <div className="flex gap-2">
            <Button type="submit">絞り込み</Button>
            <Link
              href="/hq/catalog"
              className="inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-semibold text-ink-soft hover:bg-surface-2"
            >
              クリア
            </Link>
          </div>
        </form>
      </Card>

      <datalist id="search-maker">
        {makerSuggest.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      <datalist id="search-model">
        {modelOptions.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>

      <CatalogGrid groups={groups} makerOptions={makerSuggest} />
    </div>
  );
}
