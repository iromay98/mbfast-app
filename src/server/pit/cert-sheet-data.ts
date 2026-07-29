/*
 * 証明書レコード → 帳票表示用の値。
 * 店舗の詳細画面と共有ページ（ログイン不要）で同じ変換を使う＝表示の食い違いを作らない。
 * 復号済みの値はこの関数の外（vehicle-register.readVehicleSecrets）で取得して渡す。
 */
import { moduleDef } from "@/server/pit/cert-fields";
import { certificateTypeLabel, certificateNumberOf } from "@/server/pit/certificate";
import type { CertificateSheetProps, SheetRow } from "@/components/certificate-sheet";

const STATUS_LABEL: Record<string, string> = {
  draft: "下書き（未発行）",
  issued: "",
  voided: "無効",
  failed: "発行失敗",
};

function ymdJa(d: Date | null): string {
  if (!d) return "";
  const j = new Date(d.getTime() + 9 * 3600 * 1000);
  return `${j.getUTCFullYear()}年${j.getUTCMonth() + 1}月${j.getUTCDate()}日`;
}

function ymJa(d: Date | null): string {
  if (!d) return "";
  const j = new Date(d.getTime() + 9 * 3600 * 1000);
  return `${j.getUTCFullYear()}年${j.getUTCMonth() + 1}月`;
}

function dateTimeJa(d: Date | null): string {
  if (!d) return "";
  const j = new Date(d.getTime() + 9 * 3600 * 1000);
  const hh = String(j.getUTCHours()).padStart(2, "0");
  const mm = String(j.getUTCMinutes()).padStart(2, "0");
  return `${ymdJa(d)} ${hh}:${mm}`;
}

const yen = (n: number | null) => (n === null ? "" : `${n.toLocaleString("ja-JP")}円`);
const km = (n: number | null) => (n === null ? "" : `${n.toLocaleString("ja-JP")}km`);

type CertRecord = {
  id: string;
  status: string;
  certificateType: string;
  legalRecord: boolean;
  issuedAt: Date | null;
  serviceDate: Date;
  odometerKm: number | null;
  staffName: string;
  staffLicenseNo: string;
  workSummary: string;
  totalAmount: number | null;
  restorationCostEstimate: number | null;
  payloadHash: string;
  voidedAt: Date | null;
  voidReason: string;
  details: { module: string; fieldKey: string; fieldValue: string; unit: string }[];
  customer: { name: string; address: string; tel: string } | null;
  vehicle: {
    vehicleName: string | null;
    maker: string | null;
    modelCode: string | null;
    chassisLast3: string | null;
    firstRegisteredOn: Date | null;
  };
  store: { displayName: string; address: string; tel: string; certificationNo: string };
};

export function toSheetProps(
  cert: CertRecord,
  secrets: { vin: string | null; registrationNumber: string | null },
): CertificateSheetProps {
  const details: SheetRow[] = cert.details.map((d) => {
    const def = moduleDef(d.module)?.fields.find((f) => f.key === d.fieldKey);
    return {
      label: def?.label ?? d.fieldKey,
      value: d.unit ? `${d.fieldValue} ${d.unit}` : d.fieldValue,
    };
  });

  return {
    certificateNo: certificateNumberOf(cert),
    typeLabel: certificateTypeLabel(cert.certificateType),
    statusLabel: STATUS_LABEL[cert.status] ?? cert.status,
    legalRecord: cert.legalRecord,
    issuedLabel: dateTimeJa(cert.issuedAt),
    vehicle: {
      name: cert.vehicle.vehicleName ?? "",
      maker: cert.vehicle.maker ?? "",
      modelCode: cert.vehicle.modelCode ?? "",
      firstRegistered: ymJa(cert.vehicle.firstRegisteredOn),
      vin: secrets.vin ?? "",
      registrationNumber: secrets.registrationNumber ?? "",
      chassisLast3: cert.vehicle.chassisLast3 ?? "",
    },
    customer: {
      name: cert.customer?.name ?? "",
      address: cert.customer?.address ?? "",
      tel: cert.customer?.tel ?? "",
    },
    store: {
      name: cert.store.displayName,
      address: cert.store.address,
      tel: cert.store.tel,
      certificationNo: cert.store.certificationNo,
    },
    service: {
      dateLabel: ymdJa(cert.serviceDate),
      odometerKm: km(cert.odometerKm),
      staffName: cert.staffName,
      staffLicenseNo: cert.staffLicenseNo,
      workSummary: cert.workSummary,
      totalAmount: yen(cert.totalAmount),
      restorationCostEstimate: yen(cert.restorationCostEstimate),
    },
    details,
    payloadHash: cert.payloadHash,
    voided: cert.voidedAt ? { at: ymdJa(cert.voidedAt), reason: cert.voidReason } : null,
  };
}
