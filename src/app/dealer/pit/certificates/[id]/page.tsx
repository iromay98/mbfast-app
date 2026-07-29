import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { pitMetadata } from "@/lib/pit-metadata";
import { PageTitle, Card } from "@/components/ui";
import { requireDealer } from "@/lib/authz";
import { ownPitStore } from "@/server/pit/own-store";
import { getStoreCertificate } from "@/server/pit/certificate";
import { readVehicleSecrets } from "@/server/pit/vehicle-register";
import { toSheetProps } from "@/server/pit/cert-sheet-data";
import { isLegalRecordFacility } from "@/server/pit/cert-fields";
import { CertificateSheet } from "@/components/certificate-sheet";
import { CertificateActions } from "./certificate-actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pitMetadata("mbPIT 施工証明書");

// 証明書の詳細。帳票をそのまま表示し、発行・共有・訂正・印刷をここから行う。
// 車台番号・登録番号の表示は監査ログ付きの復号を通す（誰がいつ見たかを残す）。
export default async function CertificateDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireDealer();
  const own = await ownPitStore();
  if (!own.store) notFound();

  const cert = await getStoreCertificate(own.store.id, id);
  if (!cert) notFound();

  const secrets = await readVehicleSecrets(cert.vehicleId, {
    actorUserId: user.id,
    actorRole: "dealer",
    purpose: "証明書の表示（店舗）",
    certificateId: cert.id,
  });
  const sheet = toSheetProps(cert, secrets);

  const warnings: string[] = [];
  if (isLegalRecordFacility(cert.store.facilityType)) {
    if (!cert.customer?.address) warnings.push("依頼者の住所が未入力です。法定記録簿には住所の記載が必要です");
    if (!cert.store.certificationNo) warnings.push("店舗の認証番号が未登録です（店舗情報から登録してください）");
  }
  if (!secrets.vin) {
    warnings.push("車台番号を復号できませんでした（暗号鍵の設定を本部に確認してください）");
  }
  if (cert.errorMessage) warnings.push(`前回の発行に失敗しています: ${cert.errorMessage}`);

  return (
    <div className="space-y-3">
      <div className="no-print">
        <PageTitle
          title="施工証明書"
          subtitle={cert.status === "issued" ? "発行済み。お客様へURLを渡せます" : "下書き。内容を確認して発行します"}
        />
        <Link href="/dealer/pit/certificates" className="text-xs text-ink-soft hover:underline">
          ← 証明書の一覧へ
        </Link>
      </div>

      <CertificateActions
        certificateId={cert.id}
        status={cert.status}
        shareUrl={cert.status === "issued" ? `/cert/${cert.shareToken}` : null}
        shareRevoked={cert.shareRevoked}
        warrantyUntil=""
        warnings={warnings}
      />

      {cert.verifyLast3 && cert.status === "issued" && (
        <Card className="no-print">
          <p className="text-xs font-semibold text-ink">
            共有リンクを開くとき、車台番号の下3桁（{cert.verifyLast3}）の入力を求めます。お客様にお伝えください。
          </p>
        </Card>
      )}

      <div className="rounded-xl border border-line bg-white">
        <CertificateSheet {...sheet} />
      </div>
    </div>
  );
}
