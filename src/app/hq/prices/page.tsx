import { requireHQ } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { PageTitle, Card } from "@/components/ui";
import {
  toColumns,
  toPrices,
  toRemote,
  sortBrandsForDisplay,
  sortVehiclesForDisplay,
  type BrandRow,
  type VehicleRow,
} from "@/lib/prices/types";
import { PriceBoard } from "./price-board";
import { overseasShipping } from "@/lib/vehicle-pages/delivery";
import { toOptions as toVpageOptions } from "@/lib/vehicle-pages/options";
import { loadOptionDefs } from "@/lib/vehicle-pages/options-db";
import type { VpageInfo } from "./vpage-cells";

export const dynamic = "force-dynamic";

// 本店：価格表マスタ。ここが唯一の正で、公開HTMLはここから生成する（Step 2）。
export default async function HqPricesPage() {
  await requireHQ();

  // 並びは代理店画面・公開HP生成と同じ共通ルール（src/lib/prices/types.ts）で揃える
  const brands = sortBrandsForDisplay(
    await prisma.priceBrand.findMany({
      include: {
        vehicles: { orderBy: { displayOrder: "asc" }, include: { page: true } },
      },
    }),
  );

  const optionDefs = await loadOptionDefs();
  const settingRow = await prisma.shopSetting.findUnique({ where: { id: "default" } });
  const shopSetting = {
    shippingDomesticJpy: settingRow?.shippingDomesticJpy ?? 0,
    shippingOverseasJpy: overseasShipping(settingRow?.shippingOverseasJpy),
    deviceAtOneJpy: settingRow?.deviceAtOneJpy ?? null,
    deviceIxiJpy: settingRow?.deviceIxiJpy ?? null,
    mailInBaseFeeJpy: settingRow?.mailInBaseFeeJpy ?? null,
    usdRate: settingRow?.usdRate ?? null,
  };
  const optionRows = (
    await prisma.vehiclePageOption.findMany({ orderBy: { displayOrder: "asc" } })
  ).map((o) => ({
    id: o.id,
    key: o.key,
    jp: o.labelJa,
    en: o.labelEn,
    short: o.shortLabel ?? undefined,
    derivedFrom: o.derivedFrom ?? undefined,
    enabled: o.enabled,
    priceJpy: o.priceJpy ?? null,
  }));
  const data = brands.map((b) => {
    const brand: BrandRow = {
      id: b.id,
      displayName: b.displayName,
      slug: b.slug,
      namespacePrefix: b.namespacePrefix,
      seriesGroups: b.seriesGroups,
      columns: toColumns(b.columns),
      intro: b.intro ?? "",
      jsonLdDescription: b.jsonLdDescription ?? "",
      wordPressPageId: b.wordPressPageId,
      vehicleCount: b.vehicles.length,
    };
    const vehicles: (VehicleRow & { vpage: VpageInfo })[] = sortVehiclesForDisplay(b.vehicles).map((v) => ({
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
      pageGroup: v.pageGroup ?? null,
      displayOrder: v.displayOrder,
      vpage: v.page ? { status: v.page.status, options: toVpageOptions(v.page.options) } : null,
    }));
    return { brand, vehicles };
  });

  const total = data.reduce((n, d) => n + d.vehicles.length, 0);

  return (
    <div>
      <PageTitle title="価格表" subtitle={`${data.length} ブランド / ${total} モデル`} />
      <Card className="mb-3 border-sky-200 bg-sky-50">
        <p className="text-xs text-sky-800">
          セルをクリックするとその場で編集でき、<b>Enter または他の場所をクリック</b>で保存されます（Escで取消）。
          価格は数字のみ入力（例: <code>165000</code>）。<b>空欄にすると公開ページではLINE問合せボタン</b>になります。
          <code>ASK</code> と入力すると「要問合せ」表示です。右端の<b>「頁」列は車両ページの公開状態</b>、その隣は対応オプション（タップで 未・→〇→—）。バブリング/TCU/リミッター解除は価格セルから自動判定されます。
        </p>
      </Card>
      {data.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-soft">価格表データがまだありません。</p>
        </Card>
      ) : (
        <PriceBoard data={data} optionDefs={optionDefs} optionRows={optionRows} shopSetting={shopSetting} />
      )}
    </div>
  );
}
