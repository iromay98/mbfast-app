import type { Metadata } from "next";
import Link from "next/link";
import { pitMetadata } from "@/lib/pit-metadata";
import { PageTitle, Card, EmptyState } from "@/components/ui";
import { ownPitStore } from "@/server/pit/own-store";
import { listStoreCertificates, certificateTypeLabel } from "@/server/pit/certificate";
import { listStoreVehicles } from "@/server/pit/customer-repo";
import { retentionSummary } from "@/server/pit/legal-record";
import { isLegalRecordFacility } from "@/server/pit/cert-fields";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pitMetadata("mbPIT 施工証明書");

const STATUS: Record<string, { label: string; cls: string }> = {
  draft: { label: "下書き", cls: "bg-amber-100 text-amber-800" },
  issued: { label: "発行済み", cls: "bg-emerald-100 text-emerald-800" },
  voided: { label: "無効", cls: "bg-neutral-200 text-neutral-700" },
  failed: { label: "発行失敗", cls: "bg-red-100 text-red-700" },
};

const ymd = (d: Date) => d.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" });

// 自店が作った証明書の一覧。未発行（下書き・失敗）を先頭に見せて、渡し忘れを防ぐ
export default async function CertificatesPage() {
  const own = await ownPitStore();
  if (!own.store) {
    return (
      <div>
        <PageTitle title="施工証明書" />
        <Card>
          <p className="text-sm font-semibold text-ink">{own.error}</p>
        </Card>
      </div>
    );
  }

  const [rows, vehicles, retention] = await Promise.all([
    listStoreCertificates(own.store.id),
    listStoreVehicles(own.store.id),
    retentionSummary(own.store.id),
  ]);
  const legalMode = isLegalRecordFacility(own.store.facilityType);
  const unissued = rows.filter((r) => r.status === "draft" || r.status === "failed");
  const rest = rows.filter((r) => r.status !== "draft" && r.status !== "failed");

  return (
    <div className="space-y-3">
      <PageTitle title="施工証明書" subtitle="1回の入力から、お客様へ渡す証明書を発行します" />

      {vehicles.length === 0 ? (
        <Card className="border-gold-300">
          <p className="text-sm font-bold text-ink">まず車両を登録してください</p>
          <p className="mt-1 text-xs text-ink-soft">
            証明書は車両に紐づけて発行します。車検証を撮ると必要な情報がまとめて入ります。
          </p>
          <Link
            href="/dealer/pit/vehicles"
            className="mt-3 inline-block rounded-lg bg-gold-500 px-4 py-2.5 text-sm font-bold text-white"
          >
            車両を登録する
          </Link>
        </Card>
      ) : (
        <Link
          href="/dealer/pit/certificates/new"
          className="block rounded-lg bg-gold-500 px-4 py-3 text-center text-sm font-bold text-white"
        >
          ＋ 証明書を作成
        </Link>
      )}

      {unissued.length > 0 && (
        <Card className="border-amber-300 p-0">
          <p className="border-b border-line px-3 py-2 text-xs font-bold text-ink">
            未発行が{unissued.length}件あります（お客様にまだ渡せていません）
          </p>
          {unissued.map((r) => (
            <Row key={r.id} row={r} />
          ))}
        </Card>
      )}

      {legalMode && (
        <Card>
          <h3 className="text-sm font-bold text-ink">法定記録簿モード（認証工場・指定工場）</h3>
          <p className="mt-1 text-xs text-ink-soft">
            この店舗の証明書は記録簿としても扱います。依頼者の氏名・住所、認証番号、担当者名、作業概要が
            揃っていないと発行できません（記録として成立しないため）。
            {own.store.certificationNo ? "" : " 認証番号が未登録です。本部にご連絡ください。"}
          </p>
        </Card>
      )}

      {retention.total > 0 && (
        <Card>
          <h3 className="text-sm font-bold text-ink">記録の書き出し</h3>
          <p className="mt-1 text-xs text-ink-soft">
            発行済み・無効化済みの{retention.total}件をCSVで書き出せます（Excelで開けます）。
            {retention.keepUntil && `保存期限がいちばん遅い記録は ${ymd(retention.keepUntil)} までです。`}
            <br />
            <span className="font-semibold text-ink">
              mbPITをやめても、記録の保存義務（法定記録簿は記載の日から2年）はお店に残ります。
            </span>
            退会・廃業の前に必ず書き出して保管してください。
          </p>
          <a
            href="/api/pit/records/export"
            className="mt-3 inline-block rounded-lg border border-line px-3 py-2.5 text-sm font-semibold text-ink"
          >
            ⬇ 記録をCSVで書き出す
          </a>
          <p className="mt-2 text-[11px] text-ink-soft">
            CSVには車台番号・お客様の氏名住所が含まれます。取り扱いにご注意ください。
          </p>
        </Card>
      )}

      {rest.length === 0 && unissued.length === 0 ? (
        <EmptyState message="まだ証明書がありません。施工したら1件作ってみましょう。" />
      ) : (
        rest.length > 0 && (
          <Card className="divide-y divide-line p-0">
            {rest.map((r) => (
              <Row key={r.id} row={r} />
            ))}
          </Card>
        )
      )}
    </div>
  );
}

function Row({ row }: { row: Awaited<ReturnType<typeof listStoreCertificates>>[number] }) {
  const s = STATUS[row.status] ?? { label: row.status, cls: "bg-surface-2 text-ink-soft" };
  return (
    <Link
      href={`/dealer/pit/certificates/${row.id}`}
      className="flex items-center gap-2 p-3 hover:bg-surface-2"
    >
      <div className="min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="truncate text-sm font-semibold text-ink">
            {row.vehicleName || "車両"}
          </span>
          <span className="shrink-0 text-[11px] text-ink-soft">{certificateTypeLabel(row.certificateType)}</span>
        </div>
        <div className="mt-0.5 truncate text-xs text-ink-soft">
          {row.customerName && <span className="mr-2">{row.customerName} 様</span>}
          施工 {ymd(row.serviceDate)}
          {row.chassisLast3 && <span className="ml-2">車台下3桁 {row.chassisLast3}</span>}
        </div>
        {row.errorMessage && <p className="mt-0.5 text-[11px] font-semibold text-red-600">{row.errorMessage}</p>}
      </div>
      <span className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${s.cls}`}>{s.label}</span>
      {row.status === "issued" && row.shareRevoked && (
        <span className="shrink-0 text-[11px] text-ink-soft">共有停止中</span>
      )}
    </Link>
  );
}
