import type { Metadata } from "next";
import { pitMetadata } from "@/lib/pit-metadata";
import { redirect } from "next/navigation";
import { PageTitle } from "@/components/ui";
import { ownPitStore } from "@/server/pit/own-store";
import { listStoreCustomers, listStoreVehicles } from "@/server/pit/customer-repo";
import { listStoreCertificates } from "@/server/pit/certificate";
import {
  CustomersClient,
  type CustomerRow,
  type CustomerVehicle,
  type CustomerCertificate,
} from "./customers-client";
import { PitSubNav } from "../pit-sub-nav";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pitMetadata("mbPIT 顧客カルテ");

// 顧客カルテ（自店のみ・車検満了日の近い順）。個人情報のため本部画面には出さない
export default async function PitCustomersPage() {
  const own = await ownPitStore();
  if (!own.store) redirect("/dealer/pit");

  const [customers, vehicles, certificates] = await Promise.all([
    listStoreCustomers(own.store.id),
    listStoreVehicles(own.store.id),
    listStoreCertificates(own.store.id),
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

  // 施工履歴（証明書）もカルテの中に出す。下書きが迷子にならないよう未発行を先に。
  const certsByCustomer = new Map<string, CustomerCertificate[]>();
  for (const c of certificates) {
    if (!c.customerId) continue;
    const list = certsByCustomer.get(c.customerId) ?? [];
    list.push({
      id: c.id,
      status: c.status,
      vehicleName: c.vehicleName,
      serviceDate: c.serviceDate.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" }),
    });
    certsByCustomer.set(c.customerId, list);
  }
  for (const list of certsByCustomer.values()) {
    list.sort((a, b) => {
      const unissued = (s: string) => (s === "draft" || s === "failed" ? 0 : 1);
      return unissued(a.status) - unissued(b.status);
    });
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
    certificates: certsByCustomer.get(c.id) ?? [],
  }));

  return (
    <div>
      <PitSubNav
        current="customers"
        unissued={certificates.filter((c) => c.status === "draft" || c.status === "failed").length}
      />
      <PageTitle title="顧客カルテ" subtitle={`${rows.length} 名`} />
      <CustomersClient customers={rows} />
    </div>
  );
}
