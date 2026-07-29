import type { Metadata } from "next";
import Link from "next/link";
import { requireHQ } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { PageTitle, Card, EmptyState } from "@/components/ui";
import { actingPitStore } from "@/server/pit/acting-store";
import { listStoreCertificates, certificateTypeLabel } from "@/server/pit/certificate";
import { retentionSummary } from "@/server/pit/legal-record";
import { StorePicker } from "../store-picker";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "mbPIT 施工証明書（本部代行）" };

const STATUS: Record<string, string> = {
  draft: "下書き",
  issued: "発行済み",
  voided: "無効",
  failed: "発行失敗",
};
const ymd = (d: Date) => d.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" });

// 本部が店舗を選んで証明書を作成・発行する（代行入力）。記録のCSV書き出しもここから。
export default async function HqPitCertificatesPage({
  searchParams,
}: {
  searchParams: Promise<{ storeId?: string }>;
}) {
  await requireHQ();
  const { storeId = "" } = await searchParams;

  const stores = await prisma.pitStore.findMany({
    orderBy: { displayName: "asc" },
    select: { id: true, displayName: true, dealer: { select: { name: true } }, active: true },
  });
  const options = stores.map((s) => ({
    id: s.id,
    label: `${s.displayName}（${s.dealer?.name ?? "本店直営"}${s.active ? "" : "・停止中"}）`,
  }));

  const acting = storeId ? await actingPitStore(storeId) : { error: "店舗を選択してください" };
  const rows = acting.store ? await listStoreCertificates(acting.store.id) : [];
  const retention = acting.store ? await retentionSummary(acting.store.id) : null;

  return (
    <div className="space-y-3">
      <PageTitle title="施工証明書（本部代行）" subtitle="店舗を選んで、その店舗の証明書を作成・発行します" />
      <Card>
        <StorePicker stores={options} storeId={storeId} path="/hq/pit/certificates" />
        {acting.store && (
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Link
              href={`/hq/pit/certificates/new?storeId=${storeId}`}
              className="rounded-lg bg-gold-500 px-3 py-2 text-xs font-bold text-white"
            >
              ＋ 証明書を作成
            </Link>
            <Link href={`/hq/pit/vehicles?storeId=${storeId}`} className="text-xs text-gold-700 hover:underline">
              車両登録 →
            </Link>
            {retention && retention.total > 0 && (
              <a href={`/api/pit/records/export?storeId=${storeId}`} className="text-xs text-gold-700 hover:underline">
                記録{retention.total}件をCSVで書き出す
              </a>
            )}
          </div>
        )}
      </Card>

      {!acting.store ? (
        <Card>
          <p className="text-sm font-semibold text-ink">{acting.error}</p>
        </Card>
      ) : rows.length === 0 ? (
        <EmptyState message="この店舗の証明書はまだありません。" />
      ) : (
        <Card className="divide-y divide-line p-0">
          {rows.map((r) => (
            <Link
              key={r.id}
              href={`/hq/pit/certificates/${r.id}?storeId=${storeId}`}
              className="flex items-center gap-2 p-3 hover:bg-surface-2"
            >
              <div className="min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="truncate text-sm font-semibold text-ink">{r.vehicleName || "車両"}</span>
                  <span className="shrink-0 text-[11px] text-ink-soft">
                    {certificateTypeLabel(r.certificateType)}
                  </span>
                </div>
                <div className="mt-0.5 truncate text-xs text-ink-soft">
                  {r.customerName && <span className="mr-2">{r.customerName} 様</span>}
                  施工 {ymd(r.serviceDate)}
                  {r.chassisLast3 && <span className="ml-2">車台下3桁 {r.chassisLast3}</span>}
                </div>
                {r.errorMessage && (
                  <p className="mt-0.5 text-[11px] font-semibold text-red-600">{r.errorMessage}</p>
                )}
              </div>
              <span className="ml-auto shrink-0 text-[11px] font-bold text-ink-soft">
                {STATUS[r.status] ?? r.status}
              </span>
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}
