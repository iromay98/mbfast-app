import type { Metadata } from "next";
import Link from "next/link";
import { requireHQ } from "@/lib/authz";
import { PageTitle, Card } from "@/components/ui";
import { actingPitStore } from "@/server/pit/acting-store";
import { listStoreVehicles } from "@/server/pit/customer-repo";
import { modulesForFacility, isLegalRecordFacility } from "@/server/pit/cert-fields";
import { photoOcrEnabled } from "@/server/pit/photo-ocr";
import { CERTIFICATE_TYPES } from "@/server/pit/certificate";
import {
  CertificateForm,
  type TypeOption,
  type VehicleOption,
} from "@/app/dealer/pit/certificates/certificate-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "mbPIT 証明書の作成（本部代行）" };

// 本部代行の証明書作成。加盟店と同じフォームを使い、対象店舗を storeId で渡す。
export default async function HqNewCertificatePage({
  searchParams,
}: {
  searchParams: Promise<{ storeId?: string; vehicleId?: string }>;
}) {
  await requireHQ();
  const { storeId = "", vehicleId } = await searchParams;
  const acting = await actingPitStore(storeId);
  if (!acting.store) {
    return (
      <div>
        <PageTitle title="証明書の作成（本部代行）" />
        <Card>
          <p className="text-sm font-semibold text-ink">{acting.error}</p>
          <Link href="/hq/pit/certificates" className="mt-2 inline-block text-xs text-gold-700 hover:underline">
            店舗を選ぶ →
          </Link>
        </Card>
      </div>
    );
  }

  const vehicles = await listStoreVehicles(acting.store.id);
  if (vehicles.length === 0) {
    return (
      <div>
        <PageTitle title="証明書の作成（本部代行）" subtitle={acting.store.displayName} />
        <Card className="border-gold-300">
          <p className="text-sm font-bold text-ink">先にこの店舗の車両を登録してください</p>
          <Link
            href={`/hq/pit/vehicles?storeId=${storeId}`}
            className="mt-3 inline-block rounded-lg bg-gold-500 px-4 py-2.5 text-sm font-bold text-white"
          >
            車両を登録する
          </Link>
        </Card>
      </div>
    );
  }

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
  const preferred = options.find((o) => o.vehicleId === vehicleId) ?? options[0];

  return (
    <div>
      <PageTitle title="証明書の作成（本部代行）" subtitle={acting.store.displayName} />
      <CertificateForm
        vehicles={options}
        types={types}
        legalRecordMode={isLegalRecordFacility(acting.store.facilityType)}
        ocrEnabled={photoOcrEnabled()}
        initial={{ vehicleId: preferred.vehicleId, customerId: preferred.customerId }}
        storeId={acting.store.id}
        basePath="/hq/pit"
      />
    </div>
  );
}
