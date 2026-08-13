import Link from "next/link";
import { requireHQ } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { dealerStatusLabels } from "@/lib/labels";
import { PageTitle, Card, Badge, EmptyState, LinkButton } from "@/components/ui";
import { contractStatus, formatContractDate, renewalLabel } from "@/lib/contract";

export default async function DealersPage() {
  await requireHQ();
  const dealers = await prisma.dealer.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      _count: { select: { users: true, serviceRecords: true } },
    },
  });

  /*
   * 契約更新の見張り。次回更新日は保存せず開始日から計算する（src/lib/contract.ts）。
   * 「見直し時期」に入った代理店を一覧の先頭にまとめて出す＝条件変更の申し出を逃さない。
   * 解約済み・開始日未登録は対象外（催促しない）。
   */
  const rows = dealers.map((d) => ({ dealer: d, contract: contractStatus(d) }));
  const dueSoon = rows
    .filter((r) => r.contract.noticeDue && r.dealer.status === "ACTIVE")
    .sort((a, b) => (a.contract.daysUntilRenewal ?? 0) - (b.contract.daysUntilRenewal ?? 0));
  const missingStart = rows.filter((r) => !r.contract.startedAt && r.dealer.status === "ACTIVE");

  return (
    <div>
      <PageTitle
        title="代理店管理"
        subtitle={`${dealers.length} 店`}
        action={<LinkButton href="/hq/dealers/new">＋ 新規登録</LinkButton>}
      />

      {/* 更新が近い代理店（条件の見直し時期） */}
      {dueSoon.length > 0 && (
        <Card className="mb-3 border-amber-300 bg-amber-50/60">
          <h2 className="mb-1 text-sm font-bold text-amber-900">
            🗓 契約更新が近い代理店（{dueSoon.length}件）
          </h2>
          <p className="mb-2 text-[11px] text-ink-soft">
            条件を変える場合はこの期間に申し出ます。更新日を過ぎたものは自動更新扱いなので、内容の確認だけしてください。
          </p>
          <div className="space-y-1.5">
            {dueSoon.map(({ dealer, contract }) => (
              <Link
                key={dealer.id}
                href={`/hq/dealers/${dealer.id}`}
                className="flex flex-wrap items-center gap-2 rounded-lg bg-surface px-3 py-2 text-xs hover:bg-surface-2"
              >
                <span className="font-semibold text-ink">{dealer.name}</span>
                <span
                  className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                    (contract.daysUntilRenewal ?? 0) < 0
                      ? "bg-red-100 text-red-800"
                      : (contract.daysUntilRenewal ?? 0) <= 14
                        ? "bg-red-100 text-red-800"
                        : "bg-amber-100 text-amber-800"
                  }`}
                >
                  {renewalLabel(contract)}
                </span>
                <span className="text-ink-soft">{contract.termNumber}期目に入ります</span>
                {dealer.contractNote && (
                  <span className="ml-auto max-w-[24rem] truncate text-ink-soft" title={dealer.contractNote}>
                    メモ: {dealer.contractNote}
                  </span>
                )}
              </Link>
            ))}
          </div>
        </Card>
      )}

      {/* 契約開始日が未登録（更新日を計算できない） */}
      {missingStart.length > 0 && (
        <Card className="mb-3">
          <p className="text-xs text-ink-soft">
            契約開始日が未登録: {missingStart.map((r) => r.dealer.name).join("・")}
            <br />
            各代理店の「基本情報 → 契約（1年更新）」に開始日を入れると、次回更新日と見直し時期を自動で出します。
          </p>
        </Card>
      )}

      {dealers.length === 0 ? (
        <EmptyState message="代理店がまだ登録されていません。" />
      ) : (
        <Card className="divide-y divide-line p-0">
          {rows.map(({ dealer: d, contract }) => (
            <Link
              key={d.id}
              href={`/hq/dealers/${d.id}`}
              className="flex items-center justify-between gap-3 p-4 hover:bg-surface-2"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="truncate font-medium text-ink">{d.name}</span>
                  <Badge color={d.status === "ACTIVE" ? "green" : "gray"}>
                    {dealerStatusLabels[d.status]}
                  </Badge>
                  {contract.noticeDue && d.status === "ACTIVE" && (
                    <Badge color="gold">更新間近</Badge>
                  )}
                </div>
                <div className="mt-0.5 text-xs text-ink-soft">
                  {d.address ?? "住所未登録"}
                </div>
                {/* 契約: 開始日と次回更新日（未登録なら促す） */}
                <div className="mt-0.5 text-[11px] text-ink-soft">
                  {contract.endedAt
                    ? `契約終了 ${formatContractDate(contract.endedAt)}`
                    : contract.startedAt
                      ? `契約 ${formatContractDate(contract.startedAt)} 〜 ／ 次回更新 ${formatContractDate(contract.nextRenewalAt)}`
                      : "契約開始日 未登録"}
                </div>
              </div>
              <div className="shrink-0 text-right text-xs text-ink-soft">
                <div>施工 {d._count.serviceRecords} 件</div>
                <div>アカウント {d._count.users}</div>
              </div>
            </Link>
          ))}
        </Card>
      )}
    </div>
  );
}
