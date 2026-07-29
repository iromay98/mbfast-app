import type { Metadata } from "next";
import { pitMetadata } from "@/lib/pit-metadata";
import { redirect } from "next/navigation";
import { PageTitle } from "@/components/ui";
import { ownPitStore } from "@/server/pit/own-store";
import { listStoreCustomers, listStoreVehicles } from "@/server/pit/customer-repo";
import { CustomersClient, type CustomerRow, type CustomerVehicle } from "./customers-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pitMetadata("mbPIT 顧客カルテ");

// 顧客カルテ（自店のみ・車検満了日の近い順）。個人情報のため本部画面には出さない
export default async function PitCustomersPage() {
  const own = await ownPitStore();
  if (!own.store) redirect("/dealer/pit");

  const [customers, vehicles] = await Promise.all([
    listStoreCustomers(own.store.id),
    listStoreVehicles(own.store.id),
  ]);

  // カルテの中でその方の車両を直せるようにする（車両登録画面まで行かせない）
  const byCustomer = new Map<string, CustomerVehicle[]>();
  for (const v of vehicles) {
    const list = byCustomer.get(v.customerId) ?? [];
    list.push({
      vehicleId: v.vehicleId,
      vehicleName: v.vehicleName,
      maker: v.maker,
      modelCode: v.modelCode,
      chassisLast3: v.chassisLast3,
      inspectionExpiry: v.inspectionExpiry
        ? v.inspectionExpiry.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" })
        : "",
    });
    byCustomer.set(v.customerId, list);
  }

  const rows: CustomerRow[] = customers.map((c) => ({
    id: c.id,
    name: c.name,
    kana: c.kana,
    tel: c.tel,
    vehicleName: c.vehicleName,
    inspectionExpiry: c.inspectionExpiry
      ? c.inspectionExpiry.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" })
      : "",
    note: c.note,
    address: c.address,
    email: c.email,
    vehicles: byCustomer.get(c.id) ?? [],
  }));

  return (
    <div>
      <PageTitle title="顧客カルテ" subtitle={`${rows.length} 名`} />
      <CustomersClient customers={rows} />
    </div>
  );
}
