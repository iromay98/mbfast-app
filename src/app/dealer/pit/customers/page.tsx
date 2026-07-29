import type { Metadata } from "next";
import { pitMetadata } from "@/lib/pit-metadata";
import { redirect } from "next/navigation";
import { PageTitle } from "@/components/ui";
import { ownPitStore } from "@/server/pit/own-store";
import { listStoreCustomers } from "@/server/pit/customer-repo";
import { CustomersClient, type CustomerRow } from "./customers-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pitMetadata("mbPIT 顧客カルテ");

// 顧客カルテ（自店のみ・車検満了日の近い順）。個人情報のため本部画面には出さない
export default async function PitCustomersPage() {
  const own = await ownPitStore();
  if (!own.store) redirect("/dealer/pit");

  const customers = await listStoreCustomers(own.store.id);

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
  }));

  return (
    <div>
      <PageTitle title="顧客カルテ" subtitle={`${rows.length} 名`} />
      <CustomersClient customers={rows} />
    </div>
  );
}
