import type { Metadata } from "next";
import { pitMetadata } from "@/lib/pit-metadata";
import { PageTitle, Card } from "@/components/ui";
import { ownPitStore } from "@/server/pit/own-store";
import { listStoreCustomers, listStoreVehicles } from "@/server/pit/customer-repo";
import { vehicleRegistrationReady } from "@/server/pit/vehicle-register";
import { shakenOcrEnabled } from "@/server/pit/shaken-ocr";
import { isLegalRecordFacility } from "@/server/pit/cert-fields";
import { VehiclesClient, type VehicleRow, type CustomerOption } from "./vehicles-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pitMetadata("mbPIT 車両登録");

const ymd = (d: Date | null) => (d ? d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }) : "");

// 車両登録（車検証の読み取り→確認→登録）。証明書・法定記録簿の土台になる画面。
// 表示するのは自店の顧客に紐づく車両だけ（他店の車両・顧客は出ない）
export default async function PitVehiclesPage({
  searchParams,
}: {
  // 顧客カルテの「＋ 車両を追加」から来たとき、その顧客を選んだ状態で始める
  searchParams: Promise<{ customerId?: string }>;
}) {
  const { customerId } = await searchParams;
  const own = await ownPitStore();
  if (!own.store) {
    return (
      <div>
        <PageTitle title="車両登録" />
        <Card>
          <p className="text-sm font-semibold text-ink">{own.error}</p>
        </Card>
      </div>
    );
  }

  const [vehicles, customers] = await Promise.all([
    listStoreVehicles(own.store.id),
    listStoreCustomers(own.store.id),
  ]);
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
  const options: CustomerOption[] = customers.map((c) => ({ id: c.id, name: c.name, tel: c.tel }));

  return (
    <div>
      <PageTitle title="車両登録" subtitle="車検証を撮るだけで、証明書に必要な情報が入ります" />
      <VehiclesClient
        vehicles={rows}
        customers={options}
        ocrEnabled={shakenOcrEnabled()}
        setupError={ready.ok ? null : (ready.error ?? null)}
        legalRecordMode={isLegalRecordFacility(own.store.facilityType)}
        initialCustomerId={
          customerId && options.some((o) => o.id === customerId) ? customerId : undefined
        }
      />
    </div>
  );
}
