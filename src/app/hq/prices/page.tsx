import { requireHQ } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { PageTitle, Card } from "@/components/ui";
import { toColumns, toPrices, toRemote, type BrandRow, type VehicleRow } from "@/lib/prices/types";
import { PriceBoard } from "./price-board";

export const dynamic = "force-dynamic";

// 本店：価格表マスタ。ここが唯一の正で、公開HTMLはここから生成する（Step 2）。
export default async function HqPricesPage() {
  await requireHQ();

  const brands = await prisma.priceBrand.findMany({
    orderBy: { displayOrder: "asc" },
    include: {
      vehicles: { orderBy: { displayOrder: "asc" } },
    },
  });

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
    const vehicles: VehicleRow[] = b.vehicles.map((v) => ({
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
          <code>ASK</code> と入力すると「要問合せ」表示です。
        </p>
      </Card>
      {data.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-soft">価格表データがまだありません。</p>
        </Card>
      ) : (
        <PriceBoard data={data} />
      )}
    </div>
  );
}
