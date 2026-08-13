import { requireHQ } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { PageTitle, Card } from "@/components/ui";
import { sortBrandsForDisplay } from "@/lib/prices/types";
import { toOptions } from "@/lib/vehicle-pages/options";
import { loadOptionDefs } from "@/lib/vehicle-pages/options-db";
import { brandUrlSlug, priceItemsFor } from "@/lib/vehicle-pages/resolve";
import { VpageBoard, type VpageRow } from "./vpage-board";

export const dynamic = "force-dynamic";

// 本店：車両バリアント個別ページの管理。マスタは価格表（PriceVehicle）＝価格はここでは編集しない。
// ここで扱うのは「ページとしての状態」: 公開status・対応オプション○×・実績記事の紐付け・WP反映。
export default async function HqVehiclePagesPage() {
  await requireHQ();

  const optionDefs = await loadOptionDefs();
  const brands = sortBrandsForDisplay(
    await prisma.priceBrand.findMany({
      include: {
        vehicles: {
          where: { market: "JP" },
          include: { page: true },
          orderBy: { displayOrder: "asc" },
        },
      },
    }),
  );

  const data = brands.map((b) => ({
    id: b.id,
    displayName: b.displayName,
    urlSlug: brandUrlSlug(b.id, b.slug),
    vehicleCount: b.vehicles.length,
    seeded: b.vehicles.filter((v) => v.page).length,
    pendingPush: b.vehicles.filter(
      (v) => v.page && v.page.status !== "hold" && (!v.page.wpPageIdJp || !v.page.wpPageIdEn),
    ).length,
    rows: b.vehicles
      .filter((v) => v.page)
      .map((v): VpageRow => {
        const p = v.page!;
        return {
          pageId: p.id,
          slug: p.slug,
          status: p.status,
          enPriceMode: p.enPriceMode,
          options: toOptions(p.options),
          // 価格列から自動判定される値（実ページと同じ計算）。手動設定が優先される
          derived: Object.fromEntries(
            optionDefs
              .filter((o) => o.derivedFrom)
              .map((o) => {
                const cell = priceItemsFor(b, v).find((pi) => pi.key === o.derivedFrom)?.value.trim() ?? "";
                if (cell === "—" || cell === "-") return [o.key, false] as const;
                if (cell !== "") return [o.key, true] as const;
                return [o.key, null] as const;
              })
              .filter(([, val]) => val !== null) as [string, boolean][],
          ),
          related: Array.isArray(p.relatedPosts)
            ? (p.relatedPosts as { id?: number; title: string; url: string }[])
            : [],
          wpPageIdJp: p.wpPageIdJp,
          wpPageIdEn: p.wpPageIdEn,
          carName: v.carName,
          grade: v.grade,
          engine: v.engine,
          stockOutput: v.stockOutput,
          stage1Gain: v.stage1Gain,
        };
      }),
  }));

  return (
    <div className="space-y-4">
      <PageTitle
        title="車両ページ"
        subtitle="車種×グレードごとの個別ページ（JP/EN）。価格・出力は価格表マスタから自動反映されます。ここでは公開状態・対応オプション・実績記事の紐付けを管理します。"
      />
      <Card>
        <VpageBoard brands={data} optionDefs={optionDefs} />
      </Card>
    </div>
  );
}
