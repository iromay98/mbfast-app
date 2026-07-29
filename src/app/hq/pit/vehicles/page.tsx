import type { Metadata } from "next";
import Link from "next/link";
import { requireHQ } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { PageTitle, Card } from "@/components/ui";
import { actingPitStore } from "@/server/pit/acting-store";
import { listStoreCustomers, listStoreVehicles } from "@/server/pit/customer-repo";
import { vehicleRegistrationReady } from "@/server/pit/vehicle-register";
import { shakenOcrEnabled } from "@/server/pit/shaken-ocr";
import { isLegalRecordFacility } from "@/server/pit/cert-fields";
import { VehiclesClient, type VehicleRow, type CustomerOption } from "@/app/dealer/pit/vehicles/vehicles-client";
import { StorePicker } from "../store-picker";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "mbPIT 車両登録（本部代行）" };

const ymd = (d: Date | null) => (d ? d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }) : "");

// 本部が店舗を選んで車両を登録する（本店直営店舗・加盟店の代行入力）。
// 画面は加盟店と同じコンポーネントを使い、対象店舗だけ storeId で切り替える。
export default async function HqPitVehiclesPage({
  searchParams,
}: {
  searchParams: Promise<{ storeId?: string }>;
}) {
  await requireHQ();
  const { storeId = "" } = await searchParams;

  const stores = await prisma.pitStore.findMany({
    orderBy: { displayName: "asc" },
    select: { id: true, displayName: true, dealer: { select: { name: true } }, active: true },
  });
  const options = stores.map((s) => ({
    id: s.id,
    label: `${s.displayName}（${s.dealer?.name ?? "本店直営"}${s.active ? "" : "・停止中"}）`,
  }));

  const acting = storeId ? await actingPitStore(storeId) : { error: "店舗を選択してください" };

  return (
    <div className="space-y-3">
      <PageTitle title="車両登録（本部代行）" subtitle="店舗を選んで、その店舗の車両として登録します" />
      <Card>
        <StorePicker stores={options} storeId={storeId} path="/hq/pit/vehicles" />
        <p className="mt-2 text-[11px] text-ink-soft">
          登録した車両・顧客は選んだ店舗のものになります。証明書もその店舗名で発行されます。
        </p>
        {acting.store && (
          <Link
            href={`/hq/pit/certificates?storeId=${storeId}`}
            className="mt-2 inline-block text-xs text-gold-700 hover:underline"
          >
            この店舗の施工証明書 →
          </Link>
        )}
      </Card>

      {!acting.store ? (
        <Card>
          <p className="text-sm font-semibold text-ink">{acting.error}</p>
        </Card>
      ) : (
        <VehiclesClientForStore storeId={acting.store.id} facilityType={acting.store.facilityType} />
      )}
    </div>
  );
}

async function VehiclesClientForStore({ storeId, facilityType }: { storeId: string; facilityType: string }) {
  const [vehicles, customers] = await Promise.all([listStoreVehicles(storeId), listStoreCustomers(storeId)]);
  const ready = vehicleRegistrationReady();
  const rows: VehicleRow[] = vehicles.map((v) => ({
    vehicleId: v.vehicleId,
    customerId: v.customerId,
    customerName: v.customerName,
    vehicleName: v.vehicleName,
    maker: v.maker,
    modelCode: v.modelCode,
    chassisLast3: v.chassisLast3,
    firstRegistered: v.firstRegisteredOn
      ? `${v.firstRegisteredOn.getFullYear()}年${v.firstRegisteredOn.getMonth() + 1}月`
      : "",
    inspectionExpiry: ymd(v.inspectionExpiry),
    hasVin: v.hasVin,
    hasRegNumber: v.hasRegNumber,
  }));
  const opts: CustomerOption[] = customers.map((c) => ({ id: c.id, name: c.name, tel: c.tel }));
  return (
    <VehiclesClient
      vehicles={rows}
      customers={opts}
      ocrEnabled={shakenOcrEnabled()}
      setupError={ready.ok ? null : (ready.error ?? null)}
      legalRecordMode={isLegalRecordFacility(facilityType)}
      storeId={storeId}
      basePath="/hq/pit"
    />
  );
}
