import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireHQ } from "@/lib/authz";
import { PageTitle, Card } from "@/components/ui";
import { actingPitStore } from "@/server/pit/acting-store";
import { getStoreCertificate } from "@/server/pit/certificate";
import { readVehicleSecrets } from "@/server/pit/vehicle-register";
import { toSheetProps } from "@/server/pit/cert-sheet-data";
import { isLegalRecordFacility } from "@/server/pit/cert-fields";
import { CertificateSheet } from "@/components/certificate-sheet";
import { certVerifyQr } from "@/server/pit/cert-share";
import { CertificateActions } from "@/app/dealer/pit/certificates/[id]/certificate-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "mbPIT 施工証明書（本部代行）" };

// 本部代行の証明書詳細。加盟店と同じ帳票・同じ操作パネルを storeId 付きで使う。
export default async function HqCertificateDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ storeId?: string }>;
}) {
  const user = await requireHQ();
  const { id } = await params;
  const { storeId = "" } = await searchParams;
  const acting = await actingPitStore(storeId);
  if (!acting.store) notFound();

  const cert = await getStoreCertificate(acting.store.id, id);
  if (!cert) notFound();

  const secrets = await readVehicleSecrets(cert.vehicleId, {
    actorUserId: user.id,
    actorRole: "hq",
    purpose: "証明書の表示（本部）",
    certificateId: cert.id,
  });
  const sheet = toSheetProps(cert, secrets);
  const qr = await certVerifyQr(cert);

  const warnings: string[] = [];
  if (isLegalRecordFacility(cert.store.facilityType)) {
    if (!cert.customer?.address) warnings.push("依頼者の住所が未入力です。法定記録簿には住所の記載が必要です");
    if (!cert.store.certificationNo) warnings.push("店舗の認証番号が未登録です（店舗マスタで設定してください）");
  }
  if (!secrets.vin) warnings.push("車台番号を復号できませんでした（PII_ENC_KEYS の設定を確認してください）");
  if (cert.errorMessage) warnings.push(`前回の発行に失敗しています: ${cert.errorMessage}`);

  return (
    <div className="space-y-3">
      <div className="no-print">
        <PageTitle title="施工証明書（本部代行）" subtitle={cert.store.displayName} />
        <Link href={`/hq/pit/certificates?storeId=${storeId}`} className="text-xs text-ink-soft hover:underline">
          ← この店舗の証明書一覧へ
        </Link>
      </div>

      <CertificateActions
        certificateId={cert.id}
        status={cert.status}
        shareUrl={cert.status === "issued" ? `/cert/${cert.shareToken}` : null}
        shareRevoked={cert.shareRevoked}
        warrantyUntil=""
        warnings={warnings}
        storeId={acting.store.id}
        basePath="/hq/pit"
      />

      {cert.status === "issued" && cert.retentionUntil && (
        <Card className="no-print">
          <p className="text-xs font-semibold text-ink">
            保存期限: {cert.retentionUntil.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" })} まで（
            {cert.retentionReason === "legal_record"
              ? "法定記録簿として記載の日から2年"
              : cert.retentionReason === "warranty"
                ? "保証期間の満了日まで"
                : "保持理由なし"}
            ）
          </p>
        </Card>
      )}

      <div className="rounded-xl border border-line bg-white">
        <CertificateSheet {...sheet} {...qr} revealVin />
      </div>
    </div>
  );
}
