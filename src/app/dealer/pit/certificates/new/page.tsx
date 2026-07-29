import type { Metadata } from "next";
import Link from "next/link";
import { pitMetadata } from "@/lib/pit-metadata";
import { PageTitle, Card } from "@/components/ui";
import { ownPitStore } from "@/server/pit/own-store";
import { listStoreVehicles } from "@/server/pit/customer-repo";
import { modulesForFacility, isLegalRecordFacility } from "@/server/pit/cert-fields";
import { CERTIFICATE_TYPES } from "@/server/pit/certificate";
import { CertificateForm, type TypeOption, type VehicleOption } from "../certificate-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pitMetadata("mbPIT 証明書の作成");

// 証明書の新規作成。施工種別は事業場区分で出し分ける（コーティング専門店に特定整備の項目を出さない）
export default async function NewCertificatePage({
  searchParams,
}: {
  searchParams: Promise<{ vehicleId?: string }>;
}) {
  const { vehicleId } = await searchParams;
  const own = await ownPitStore();
  if (!own.store) {
    return (
      <div>
        <PageTitle title="証明書の作成" />
        <Card>
          <p className="text-sm font-semibold text-ink">{own.error}</p>
        </Card>
      </div>
    );
  }

  const vehicles = await listStoreVehicles(own.store.id);
  if (vehicles.length === 0) {
    return (
      <div>
        <PageTitle title="証明書の作成" />
        <Card className="border-gold-300">
          <p className="text-sm font-bold text-ink">先に車両を登録してください</p>
          <Link
            href="/dealer/pit/vehicles"
            className="mt-3 inline-block rounded-lg bg-gold-500 px-4 py-2.5 text-sm font-bold text-white"
          >
            車両を登録する
          </Link>
        </Card>
      </div>
    );
  }

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
  const preferred = options.find((o) => o.vehicleId === vehicleId) ?? options[0];

  return (
    <div>
      <PageTitle title="証明書の作成" subtitle="お客様に渡す1枚を作ります。発行前に内容を確認できます" />
      <CertificateForm
        vehicles={options}
        types={types}
        legalRecordMode={isLegalRecordFacility(own.store.facilityType)}
        initial={{ vehicleId: preferred.vehicleId, customerId: preferred.customerId }}
      />
    </div>
  );
}
