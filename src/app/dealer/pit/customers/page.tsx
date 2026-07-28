import type { Metadata } from "next";
import { pitMetadata } from "@/lib/pit-metadata";
import { redirect } from "next/navigation";
import { requireDealer } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { PageTitle } from "@/components/ui";
import { CustomersClient, type CustomerRow } from "./customers-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pitMetadata("mbPIT 顧客カルテ");

// 顧客カルテ（自店のみ・車検満了日の近い順）。個人情報のため本部画面には出さない
export default async function PitCustomersPage() {
  const user = await requireDealer();
  const store = await prisma.pitStore.findUnique({
    where: { dealerId: user.dealerId },
    select: { id: true },
  });
  if (!store) redirect("/dealer/pit");

  const customers = await prisma.pitCustomer.findMany({
    where: { storeId: store.id },
    orderBy: [{ inspectionExpiry: { sort: "asc", nulls: "last" } }, { name: "asc" }],
  });

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
  }));

  return (
    <div>
      <PageTitle title="顧客カルテ" subtitle={`${rows.length} 名`} />
      <CustomersClient customers={rows} />
    </div>
  );
}
