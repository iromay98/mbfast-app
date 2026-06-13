import Link from "next/link";
import { requireHQ } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { PageTitle, Card, Button, Input, Select, Field } from "@/components/ui";
import type { Prisma } from "@/generated/prisma/client";
import { CatalogGrid, type CatalogRow, type CalGroup } from "./catalog-grid";
import { fuelKindOf, stageRank } from "@/lib/catalog/options";

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
      ecu: first.ecu,
      cal: first.cal,
      sw: first.sw,
      swSeq: first.swSeq,
      fuelKind: fuelKindOf(first.fuel),
      hasStock: first.hasStock,
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
  return `${d.getFullYear()}/${p(d.getMonth() + 1)}/${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default async function HQCatalogPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  await requireHQ();
  const sp = await searchParams;
  const q = one(sp.q).trim();
  const ecu = one(sp.ecu).trim();
  const model = one(sp.model).trim();
  const stage = one(sp.stage).trim();
  const status = one(sp.status).trim();

  const where: Prisma.TunedVariantWhereInput = {};
  const baseWhere: Prisma.BaseFileWhereInput = {};
  if (ecu) baseWhere.ecu = { contains: ecu, mode: "insensitive" };
  if (model) baseWhere.model = { contains: model, mode: "insensitive" };
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

  const [variants, pendingCount] = await Promise.all([
    prisma.tunedVariant.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: 300,
      include: {
        baseFile: true,
        versions: {
          orderBy: { version: "desc" },
          select: { id: true, version: true, fileName: true, fileHash: true, replacedAt: true },
        },
      },
    }),
    prisma.baseFile.count({
      where: { archived: false, variants: { none: { status: "AVAILABLE" } } },
    }),
  ]);

  const rows: CatalogRow[] = variants.map((v) => ({
    id: v.id,
    baseFileId: v.baseFileId,
    manufacturer: v.baseFile.manufacturer,
    model: v.baseFile.model,
    ecu: v.baseFile.ecu,
    mcu: v.baseFile.mcu ?? "",
    generation: v.baseFile.generation ?? "",
    cal: v.baseFile.calNumber ?? "",
    sw: v.baseFile.swNumber ?? "",
    swSeq: v.baseFile.swSeq ?? 0,
    fuel: v.baseFile.fuel ?? "",
    stockHash: v.baseFile.stockHash ?? "",
    hasStock: !!v.baseFile.stockFileRef,
    stage: v.stage,
    popsAndBangs: v.popsAndBangs,
    popsSport: v.popsSport,
    optionTags: v.optionTags ?? [],
    options: v.options ?? "",
    note: v.note ?? "",
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

      <Card className="mb-4">
        <form method="get" className="space-y-3">
          <Field label="キーワード（メーカー・車種・ECU・ステージ・オプション）">
            <Input name="q" defaultValue={q} placeholder="例: Audi / MED17 / Stage1" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="ECU">
              <Input name="ecu" defaultValue={ecu} placeholder="Bosch MED17.1.1" />
            </Field>
            <Field label="車種">
              <Input name="model" defaultValue={model} placeholder="S3 8V" />
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

      <CatalogGrid groups={groups} />
    </div>
  );
}
