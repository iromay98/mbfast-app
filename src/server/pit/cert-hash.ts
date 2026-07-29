/*
 * 証明書の内容ハッシュと証明書番号（DBに依存しない純関数）。
 *
 * ハッシュには平文の個人情報を入れない。車両は vehicleKey（HMAC）、依頼者は customerId で表す。
 *  → 鍵のローテーションや再暗号化でハッシュが変わらない（＝発行時の値と照合できる）
 *  → ハッシュを計算するために復号する必要がない
 * 1バイトでも内容が変われば値が変わるので、第三者が改ざんを検出できる。
 */
import { createHash } from "node:crypto";

export type CertificateHashInput = {
  vehicleKey: string;
  storeSlug: string;
  customerId: string | null;
  certificateType: string;
  serviceDate: Date;
  odometerKm: number | null;
  staffName: string;
  workSummary: string;
  totalAmount: number | null;
  details: { module: string; fieldKey: string; fieldValue: string }[];
  issuedAt: Date;
};

export function certificatePayloadHash(input: CertificateHashInput): string {
  // 項目の並び順で値が変わらないように必ず並べ替える（同じ内容＝同じハッシュ）
  const sorted = [...input.details].sort((a, b) =>
    `${a.module}:${a.fieldKey}`.localeCompare(`${b.module}:${b.fieldKey}`),
  );
  return createHash("sha256")
    .update(
      JSON.stringify({
        v: 1,
        vehicleKey: input.vehicleKey,
        storeSlug: input.storeSlug,
        customerId: input.customerId,
        certificateType: input.certificateType,
        serviceDate: input.serviceDate.toISOString().slice(0, 10),
        odometerKm: input.odometerKm,
        staffName: input.staffName,
        workSummary: input.workSummary,
        totalAmount: input.totalAmount,
        details: sorted.map((d) => [d.module, d.fieldKey, d.fieldValue]),
        issuedAt: input.issuedAt.toISOString(),
      }),
    )
    .digest("hex");
}

/** 証明書番号（人が読める通し番号。発行時に確定させる） */
export function certificateNo(id: string, issuedAt: Date): string {
  const j = new Date(issuedAt.getTime() + 9 * 3600 * 1000);
  const ymd = `${j.getUTCFullYear()}${String(j.getUTCMonth() + 1).padStart(2, "0")}${String(j.getUTCDate()).padStart(2, "0")}`;
  return `MBP-${ymd}-${id.slice(-6).toUpperCase()}`;
}
