import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { pitMetadata } from "@/lib/pit-metadata";
import { PageTitle } from "@/components/ui";
import { ownPitStore } from "@/server/pit/own-store";
import { listStoreVehicles } from "@/server/pit/customer-repo";
import { getStoreCertificate, CERTIFICATE_TYPES } from "@/server/pit/certificate";
import { modulesForFacility, isLegalRecordFacility } from "@/server/pit/cert-fields";
import { CertificateForm, type TypeOption, type VehicleOption } from "../../certificate-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pitMetadata("mbPIT 証明書の修正");

// 下書き（および発行失敗）の修正。発行済みは編集させず、詳細画面から訂正再発行に誘導する。
export default async function EditCertificatePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const own = await ownPitStore();
  if (!own.store) notFound();
  const cert = await getStoreCertificate(own.store.id, id);
  if (!cert) notFound();
  if (cert.status !== "draft" && cert.status !== "failed") redirect(`/dealer/pit/certificates/${id}`);

  const vehicles = await listStoreVehicles(own.store.id);
  const allowed = modulesForFacility(own.store.facilityType);
  const types: TypeOption[] = CERTIFICATE_TYPES.filter(
    (t) => t.key === "general" || allowed.some((m) => m.key === t.key),
  ).map((t) => ({
    key: t.key,
    label: t.label,
    fields: (allowed.find((m) => m.key === t.key)?.fields ?? []).map((f) => ({
      key: f.key,
      label: f.label,
      type: f.type,
      required: f.required,
      unit: f.unit,
      options: f.options,
      hint: f.hint,
      help: f.help,
    })),
  }));
  const options: VehicleOption[] = vehicles.map((v) => ({
    vehicleId: v.vehicleId,
    customerId: v.customerId,
    customerName: v.customerName,
    label: `${v.vehicleName || v.maker || "車両"}（${v.customerName} 様${v.chassisLast3 ? `・下3桁 ${v.chassisLast3}` : ""}）`,
  }));

  return (
    <div>
      <PageTitle title="証明書の修正" subtitle="保存すると下書きが更新されます（発行は次の画面）" />
      <CertificateForm
        certificateId={cert.id}
        vehicles={options}
        types={types}
        legalRecordMode={isLegalRecordFacility(own.store.facilityType)}
        initial={{
          vehicleId: cert.vehicleId,
          customerId: cert.customerId ?? "",
          certificateType: cert.certificateType,
          serviceDate: cert.serviceDate.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" }),
          odometerKm: cert.odometerKm === null ? "" : String(cert.odometerKm),
          staffName: cert.staffName,
          staffLicenseNo: cert.staffLicenseNo,
          workSummary: cert.workSummary,
          totalAmount: cert.totalAmount === null ? "" : String(cert.totalAmount),
          restorationCostEstimate:
            cert.restorationCostEstimate === null ? "" : String(cert.restorationCostEstimate),
          requireVerifyLast3: !!cert.verifyLast3,
          blogPostId: cert.blogPostId ?? "",
          moduleValues: Object.fromEntries(cert.details.map((d) => [d.fieldKey, d.fieldValue])),
        }}
      />
    </div>
  );
}
