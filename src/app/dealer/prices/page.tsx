import Link from "next/link";
import { requireDealer } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { PageTitle, Card } from "@/components/ui";
import { toColumns, toPrices, toRemote, type VehicleRow } from "@/lib/prices/types";
import { PriceViewer, type ViewerBrand } from "./price-viewer";

export const dynamic = "force-dynamic";

// 代理店向けの価格表（閲覧専用）。本店の価格マスタをそのまま表示する
// （公開ホームページと同じデータ源なので常に最新。編集は本店のみ）。
// 全ブランドを一度に送ると数MBになるため、選択中ブランドの車両だけを読む。
export default async function DealerPricesPage({
  searchParams,
}: {
  searchParams: Promise<{ brand?: string }>;
}) {
  await requireDealer();
  const { brand: brandParam } = await searchParams;

  const brands = await prisma.priceBrand.findMany({
    select: { id: true, displayName: true },
  });
  // メーカーも車種もアルファベット順。numeric指定で 3-Series < 30-Series のような数値順にする
  const collator = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });
  brands.sort((a, b) => collator.compare(a.displayName, b.displayName));

  const selectedId = brands.some((b) => b.id === brandParam)
    ? brandParam!
    : brands[0]?.id;

  const selected = selectedId
    ? await prisma.priceBrand.findUnique({
        where: { id: selectedId },
        include: { vehicles: true },
      })
    : null;
  selected?.vehicles.sort(
    (a, b) => collator.compare(a.carName, b.carName) || collator.compare(a.grade ?? "", b.grade ?? ""),
  );

  const viewerBrand: ViewerBrand | null = selected
    ? {
        id: selected.id,
        displayName: selected.displayName,
        seriesGroups: selected.seriesGroups,
        columns: toColumns(selected.columns),
        vehicles: selected.vehicles.map(
          (v): VehicleRow => ({
            id: v.id,
            seriesGroup: v.seriesGroup,
            carName: v.carName,
            grade: v.grade,
            engine: v.engine,
            engineFamily: v.engineFamily,
            ecuType: v.ecuType,
            stockOutput: v.stockOutput,
            stage1Gain: v.stage1Gain,
            prices: toPrices(v.prices),
            labor: v.labor,
            shops: v.shops,
            remote: toRemote(v.remote),
            notes: v.notes,
            displayOrder: v.displayOrder,
          }),
        ),
      }
    : null;

  return (
    <div>
      <PageTitle title="価格表" subtitle="公開ホームページと同じ最新価格" />
      {!viewerBrand ? (
        <Card>
          <p className="text-sm text-ink-soft">価格表データがまだありません。</p>
        </Card>
      ) : (
        <div className="space-y-3">
          {/* ブランド切替チップ（スマホは横スクロール＋上部に固定＝スクロール中もメーカーを切替できる） */}
          <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4 py-2 max-sm:sticky max-sm:top-[49px] max-sm:z-20 max-sm:bg-surface-2 sm:mx-0 sm:flex-wrap sm:px-0 sm:py-0 sm:pb-1">
            {brands.map((b) => (
              <Link
                key={b.id}
                href={`/dealer/prices?brand=${encodeURIComponent(b.id)}`}
                className={`whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
                  b.id === viewerBrand.id
                    ? "border-gold-500 bg-gold-500 text-white"
                    : "border-line bg-surface text-ink-soft hover:bg-surface-2"
                }`}
              >
                {b.displayName}
              </Link>
            ))}
          </div>
          <PriceViewer brand={viewerBrand} />
        </div>
      )}
    </div>
  );
}
