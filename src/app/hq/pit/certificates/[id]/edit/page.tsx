import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requireHQ } from "@/lib/authz";
import { PageTitle } from "@/components/ui";
import { actingPitStore } from "@/server/pit/acting-store";
import { listStoreVehicles } from "@/server/pit/customer-repo";
import { getStoreCertificate, CERTIFICATE_TYPES } from "@/server/pit/certificate";
import { modulesForFacility, isLegalRecordFacility } from "@/server/pit/cert-fields";
import { photoOcrEnabled } from "@/server/pit/photo-ocr";
import {
  CertificateForm,
  type TypeOption,
  type VehicleOption,
} from "@/app/dealer/pit/certificates/certificate-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "mbPIT 証明書の修正（本部代行）" };

// 本部代行の下書き修正。発行済みは編集させず詳細（訂正再発行）へ戻す。
export default async function HqEditCertificatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ storeId?: string }>;
}) {
  await requireHQ();
  const { id } = await params;
  const { storeId = "" } = await searchParams;
  const acting = await actingPitStore(storeId);
  if (!acting.store) notFound();
  const cert = await getStoreCertificate(acting.store.id, id);
  if (!cert) notFound();
  if (cert.status !== "draft" && cert.status !== "failed") {
    redirect(`/hq/pit/certificates/${id}?storeId=${storeId}`);
  }

  const vehicles = await listStoreVehicles(acting.store.id);
  const allowed = modulesForFacility(acting.store.facilityType);
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
      <PageTitle title="証明書の修正（本部代行）" subtitle={acting.store.displayName} />
      <CertificateForm
        certificateId={cert.id}
        vehicles={options}
        types={types}
        legalRecordMode={isLegalRecordFacility(acting.store.facilityType)}
        ocrEnabled={photoOcrEnabled()}
        storeId={acting.store.id}
        basePath="/hq/pit"
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
