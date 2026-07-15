import Link from "next/link";
import { requireHQ } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { PageTitle, EmptyState } from "@/components/ui";
import { PendingList, type PendingRow } from "./pending-list";
import { ManualStockForm } from "./manual-stock-form";

function fmt(d: Date): string {
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

export default async function PendingStockPage() {
  await requireHQ();

  // 未整備 = archived=false かつ AVAILABLE な variant を持たない BaseFile
  const bases = await prisma.baseFile.findMany({
    where: {
      archived: false,
      variants: { none: { status: "AVAILABLE", deletedAt: null } },
    },
    orderBy: [{ source: "asc" }, { createdAt: "desc" }], // AUTO_CAPTURE を先頭に
    take: 200,
    include: {
      variants: {
        where: { deletedAt: null },
        orderBy: { createdAt: "desc" },
        select: {
          id: true,
          stage: true,
          options: true,
          popsAndBangs: true,
          status: true,
          fileName: true,
        },
      },
    },
  });

  const rows: PendingRow[] = bases.map((b) => ({
    baseFileId: b.id,
    manufacturer: b.manufacturer,
    model: b.model,
    ecu: b.ecu,
    mcu: b.mcu ?? "",
    cal: b.calNumber ?? "",
    sw: b.swNumber ?? "",
    hw: b.hwNumber ?? "",
    generation: b.generation ?? "",
    method: b.method ?? "",
    fuel: b.fuel ?? "",
    stockHashShort: b.stockHash ? `${b.stockHash.slice(0, 16)}…` : "(なし)",
    unit: b.unit,
    source: b.source,
    hasStock: !!b.stockFileRef,
    capturedAtLabel: fmt(b.createdAt),
    variants: b.variants.map((v) => ({
      id: v.id,
      stage: v.stage,
      options: v.options ?? "",
      popsAndBangs: v.popsAndBangs,
      status: v.status,
      fileName: v.fileName ?? "",
    })),
  }));

  return (
    <div>
      <PageTitle
        title="未整備ストック"
        subtitle={`${rows.length} 件（mod未登録・本店専用）`}
        action={
          <Link
            href="/hq/catalog"
            className="inline-flex min-h-11 items-center rounded-lg border border-line px-4 text-sm font-semibold text-ink-soft hover:bg-surface-2"
          >
            カタログへ
          </Link>
        }
      />
      <p className="mb-4 text-sm text-ink-soft">
        復号で自動取込された純正（または手動登録）のうち、まだ配布可の mod
        が無いものです。mod ファイルを登録すると即・配布可になって一覧から外れ、照合した代理店に提示されます。
      </p>

      <ManualStockForm />

      {rows.length === 0 ? (
        <EmptyState message="未整備のストックはありません。" />
      ) : (
        <PendingList rows={rows} />
      )}
    </div>
  );
}
