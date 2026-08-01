import type { Metadata } from "next";
import { pitMetadata } from "@/lib/pit-metadata";
import { PageTitle, Card } from "@/components/ui";
import { ownPitStore } from "@/server/pit/own-store";
import { listStoreCustomers, listStoreVehicles } from "@/server/pit/customer-repo";
import { vehicleRegistrationReady } from "@/server/pit/vehicle-register";
import { shakenOcrEnabled } from "@/server/pit/shaken-ocr";
import { isLegalRecordFacility } from "@/server/pit/cert-fields";
import { VehiclesClient, type VehicleRow, type CustomerOption } from "./vehicles-client";
import { PitSubNav } from "../pit-sub-nav";
import { countUnissuedDrafts } from "@/server/pit/certificate";
import { cookies } from "next/headers";
import { SHARED_COOKIE } from "@/app/api/shaken-share/route";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pitMetadata("mbPIT 車両登録");

const ymd = (d: Date | null) => (d ? d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }) : "");

// 車両登録（車検証の読み取り→確認→登録）。証明書・法定記録簿の土台になる画面。
// 表示するのは自店の顧客に紐づく車両だけ（他店の車両・顧客は出ない）
export default async function PitVehiclesPage({
  searchParams,
}: {
  // 顧客カルテの「＋ 車両を追加」から来たとき、その顧客を選んだ状態で始める
  searchParams: Promise<{ customerId?: string; shared?: string }>;
}) {
  const { customerId, shared } = await searchParams;

  /*
   * Androidの共有シートから車検証PDFを受け取った直後（?shared=1）。
   * PDFはAPI側で読み取って捨てており、ここには**読み取った項目だけ**が
   * 短命クッキー経由で渡ってくる。DBには何も保存していない。
   */
  let sharedFields: Record<string, string> | null = null;
  let sharedError: string | null = null;
  if (shared === "1") {
    const raw = (await cookies()).get(SHARED_COOKIE)?.value;
    if (raw) {
      try {
        sharedFields = JSON.parse(raw) as Record<string, string>;
      } catch {
        sharedFields = null;
      }
    }
    if (!sharedFields) sharedError = "共有された内容を受け取れませんでした（時間が経ちすぎた可能性）。もう一度お試しください";
  } else if (shared === "notpdf") {
    sharedError = "共有されたファイルがPDFではありませんでした。車検証閲覧アプリのPDFを共有してください";
  } else if (shared === "unreadable") {
    sharedError = "共有されたPDFから車検証を読み取れませんでした。手入力で進めてください";
  } else if (shared === "toobig") {
    sharedError = "共有されたファイルが大きすぎます（15MBまで）";
  } else if (shared === "error") {
    sharedError = "共有された内容を受け取れませんでした";
  }
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

  const [vehicles, customers, unissued] = await Promise.all([
    listStoreVehicles(own.store.id),
    listStoreCustomers(own.store.id),
    countUnissuedDrafts(own.store.id),
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
      <PitSubNav current="vehicles" unissued={unissued} />
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
        sharedFields={sharedFields}
        sharedError={sharedError}
      />
    </div>
  );
}
