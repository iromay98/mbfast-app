import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { publicCertMetadata } from "@/lib/pit-metadata";
import { getSharedCertificate } from "@/server/pit/certificate";
import { readVehicleSecrets } from "@/server/pit/vehicle-register";
import { toSheetProps } from "@/server/pit/cert-sheet-data";
import { CertificateSheet } from "@/components/certificate-sheet";
import { certVerifyQr } from "@/server/pit/cert-share";
import { listPublicCertificateMedia } from "@/server/pit/cert-media";
import { PrintButton } from "./print-button";

/*
 * 施工証明書の共有ページ（ログイン不要）。
 *
 *  - URLは推測不能なトークン。検索エンジンには載せない（noindex かつ sitemap 対象外）
 *  - 同じ車両の他の証明書は表示しない（Phase 1 では車両単位の履歴閲覧はしない）
 *  - 任意で車台番号の下3桁の照合を要求できる（リンクが転送された場合の備え）
 *  - 車台番号の表示は監査ログ付きの復号を通す（共有リンク経由も記録する）
 */
export const dynamic = "force-dynamic";
export const metadata: Metadata = publicCertMetadata("施工証明書", "施工内容の記録（mbPIT）");

export default async function SharedCertificatePage({
  params,
  searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ v?: string; vin?: string }>;
}) {
  const { token } = await params;
  const { v, vin } = await searchParams;
  const result = await getSharedCertificate(token, v);

  if (result.state === "notfound") notFound();

  if (result.state === "revoked") {
    return (
      <Shell>
        <h1 className="text-base font-bold text-neutral-900">この証明書は現在ご覧いただけません</h1>
        <p className="mt-2 text-sm text-neutral-600">
          施工店が共有を停止しています。お手数ですが施工店へお問い合わせください。
        </p>
      </Shell>
    );
  }

  if (result.state === "needs_verify") {
    return (
      <Shell>
        <h1 className="text-base font-bold text-neutral-900">車台番号の下3桁を入力してください</h1>
        <p className="mt-2 text-sm text-neutral-600">
          ご本人確認のため、車検証に記載された車台番号の下3桁（数字）を入力してください。
        </p>
        <form method="get" className="mt-4 flex items-center gap-2">
          <input
            name="v"
            inputMode="numeric"
            maxLength={3}
            placeholder="000"
            className="w-24 rounded-lg border border-neutral-300 px-3 py-2 text-center text-lg font-bold tracking-widest text-neutral-900"
          />
          <button type="submit" className="rounded-lg bg-neutral-900 px-4 py-2.5 text-sm font-bold text-white">
            確認する
          </button>
        </form>
        {v !== undefined && (
          <p className="mt-2 text-sm font-semibold text-red-600">下3桁が一致しません。もう一度お試しください。</p>
        )}
      </Shell>
    );
  }

  const cert = result.cert;
  // 車台番号は既定でマスク表示。全桁は ?vin=1 を明示的に開いたときだけ（スクショ流出の被害を小さくする）
  const revealVin = vin === "1";
  const secrets = await readVehicleSecrets(cert.vehicleId, {
    // 共有リンクは誰が開いたか特定できないため、証明書単位で記録する（記録しない経路は作らない）
    actorUserId: `share:${cert.id}`,
    actorRole: "share",
    purpose: revealVin ? "証明書の共有ページ表示（車台番号を全桁表示）" : "証明書の共有ページ表示",
    certificateId: cert.id,
  });
  // マスク時は全桁をHTMLに載せない（画面はマスクなのにソースに残る状態を作らない）
  const sheet = toSheetProps(cert, revealVin ? secrets : { ...secrets, vin: null });
  const qr = await certVerifyQr(cert);
  // 公開可の写真だけ（種別の許可リストも通す）。URLはトークン配下＝証明書IDを出さない
  const photos = (await listPublicCertificateMedia(token)).map((m) => ({
    url: `/cert/${token}/media/${m.id}`,
    label: m.kindLabel,
  }));

  return (
    <div className="min-h-screen bg-neutral-200 py-4">
      <div className="mx-auto max-w-[760px] px-3">
        <div className="no-print mb-3 flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-neutral-600">
            この画面は印刷／PDF保存できます。大切に保管してください。
          </p>
          <PrintButton />
        </div>
        <CertificateSheet {...sheet} {...qr} revealVin={revealVin} photos={photos} />
        <p className="no-print mt-3 text-center text-[11px] text-neutral-500">
          {revealVin ? (
            <a href={`/cert/${token}`} className="underline">
              車台番号を隠す
            </a>
          ) : (
            <a href={`/cert/${token}?vin=1`} className="underline">
              車台番号を全桁表示する（印刷して提出するとき）
            </a>
          )}
          <br />
          発行元: {cert.store.displayName}／お問い合わせは施工店までお願いします
        </p>
      </div>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-100 p-6">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-sm">{children}</div>
    </div>
  );
}
