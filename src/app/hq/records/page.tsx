import Link from "next/link";
import { requireHQ } from "@/lib/authz";
import { prisma } from "@/lib/db";
import {
  workTypeLabels,
  recordStatusLabels,
  recordStatusColors,
  requestStatusLabels,
  requestStatusColors,
  formatDate,
} from "@/lib/labels";
import { PageTitle, Card, Badge, EmptyState, Button, Input, Select, Field } from "@/components/ui";
import type { Prisma } from "@/generated/prisma/client";
import { vehicleLabel } from "@/lib/catalog/vehicle";
import { HQSlaveUpload } from "./hq-slave-upload";

// 一覧の車両名: 照合した純正(カタログ)の "メーカー 車種(世代) グレード" を優先。
function recordTitle(r: {
  carMaker: string | null;
  carModel: string | null;
  slaveName: string | null;
  matchedBaseFile: {
    manufacturer: string;
    model: string;
    generation: string | null;
    grade: string | null;
  } | null;
}): string {
  return (
    (r.matchedBaseFile && vehicleLabel(r.matchedBaseFile)) ||
    (r.carMaker || r.carModel
      ? `${r.carMaker ?? ""} ${r.carModel ?? ""}`.trim()
      : r.slaveName || "（解析中…）")
  );
}

type SP = Record<string, string | string[] | undefined>;
function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export default async function HQRecordsPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  await requireHQ();
  const sp = await searchParams;
  const q = one(sp.q).trim();
  const workType = one(sp.workType);
  const dealerId = one(sp.dealerId);
  const from = one(sp.from);
  const to = one(sp.to);
  const view = one(sp.view); // "" = 一覧 / "customer" = 顧客別

  const where: Prisma.ServiceRecordWhereInput = { deletedAt: null };
  if (q) {
    where.OR = [
      { vin: { contains: q, mode: "insensitive" } },
      { carMaker: { contains: q, mode: "insensitive" } },
      { carModel: { contains: q, mode: "insensitive" } },
      { customerName: { contains: q, mode: "insensitive" } },
      { softwareNumber: { contains: q, mode: "insensitive" } },
      { swNumber: { contains: q, mode: "insensitive" } },
      { calNumber: { contains: q, mode: "insensitive" } },
      { hwNumber: { contains: q, mode: "insensitive" } },
    ];
  }
  if (workType && workType in workTypeLabels) {
    where.workType = workType as keyof typeof workTypeLabels;
  }
  if (dealerId) where.dealerId = dealerId;
  if (from || to) {
    where.workedAt = {};
    if (from) where.workedAt.gte = new Date(from);
    if (to) where.workedAt.lte = new Date(`${to}T23:59:59`);
  }

  const [dealers, records, openRequests] = await Promise.all([
    prisma.dealer.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.serviceRecord.findMany({
      where,
      orderBy: { workedAt: "desc" },
      take: 200,
      include: {
        dealer: { select: { name: true } },
        matchedBaseFile: {
          select: { manufacturer: true, model: true, generation: true, grade: true },
        },
      },
    }),
    // 未返却（納品/キャンセル以外）の依頼 — 一覧トップに出し、記録行にもバッジ表示
    prisma.fileRequest.findMany({
      where: { status: { notIn: ["DELIVERED", "CANCELLED"] } },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        serviceRecordId: true,
        dealer: { select: { name: true } },
      },
    }),
  ]);
  // 未返却の依頼を持つ記録ID
  const openByRecord = new Set(
    openRequests.map((r) => r.serviceRecordId).filter((x): x is string => !!x),
  );

  // 重複ファイル検出：復号後の中身(decryptedHash)が同じ＝同一ファイル。全件横断で集計。
  const dupGroups = await prisma.serviceRecord.groupBy({
    by: ["decryptedHash"],
    where: { deletedAt: null, decryptedHash: { not: null } },
    _count: { _all: true },
  });
  const dupHashes = new Set(
    dupGroups.filter((g) => g._count._all > 1).map((g) => g.decryptedHash as string),
  );
  const isDup = (r: { decryptedHash: string | null }) =>
    !!r.decryptedHash && dupHashes.has(r.decryptedHash);

  // 顧客別ビュー：顧客名でまとめる（本店を1店舗として顧客ごとに管理）。
  const customerGroups =
    view === "customer"
      ? (() => {
          const map = new Map<string, typeof records>();
          for (const r of records) {
            const key = r.customerName?.trim() || "（顧客名なし）";
            const arr = map.get(key) ?? [];
            arr.push(r);
            map.set(key, arr);
          }
          return [...map.entries()]
            .map(([name, recs]) => ({
              name,
              recs,
              latest: recs.reduce(
                (m, r) => (r.workedAt > m ? r.workedAt : m),
                recs[0].workedAt,
              ),
              dupCount: recs.filter((r) => isDup(r)).length,
            }))
            .sort((a, b) => b.latest.getTime() - a.latest.getTime());
        })()
      : [];

  // ビュー切替リンク（現在の絞り込みを維持して view だけ差し替え）
  const baseParams = new URLSearchParams();
  if (q) baseParams.set("q", q);
  if (workType) baseParams.set("workType", workType);
  if (dealerId) baseParams.set("dealerId", dealerId);
  if (from) baseParams.set("from", from);
  if (to) baseParams.set("to", to);
  const listHref = `/hq/records${baseParams.toString() ? `?${baseParams}` : ""}`;
  const custParams = new URLSearchParams(baseParams);
  custParams.set("view", "customer");
  const custHref = `/hq/records?${custParams}`;
  const dupTotalRecords = records.filter((r) => isDup(r)).length;

  return (
    <div>
      <PageTitle title="施工記録・依頼（全店横断）" subtitle={`${records.length} 件`} />

      {/* 本部代行アップロード（代理店を指定してスレーブを登録） */}
      <HQSlaveUpload dealers={dealers} />

      {/* 未返却の依頼（記録に紐づくものは記録へ、それ以外は依頼詳細へ） */}
      {openRequests.length > 0 && (
        <Card className="mb-4 border-amber-200 bg-amber-50">
          <h3 className="mb-2 text-sm font-bold text-amber-900">
            未返却の依頼（{openRequests.length}）
          </h3>
          <div className="divide-y divide-amber-200/60">
            {openRequests.map((r) => (
              <Link
                key={r.id}
                href={r.serviceRecordId ? `/hq/records/${r.serviceRecordId}` : `/hq/requests/${r.id}`}
                className="flex items-center justify-between gap-3 py-2 hover:bg-amber-100/40"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-ink">{r.title}</div>
                  <div className="mt-0.5 text-xs text-ink-soft">
                    {r.dealer.name}・{formatDate(r.createdAt)}
                  </div>
                </div>
                <Badge color={requestStatusColors[r.status]}>
                  {requestStatusLabels[r.status]}
                </Badge>
              </Link>
            ))}
          </div>
        </Card>
      )}

      {/* 検索フォーム（GETでURLに反映） */}
      <Card className="mb-4">
        <form method="get" className="space-y-3">
          <Field label="キーワード（VIN・メーカー・車種・SW/Cal/HW番号）">
            <Input name="q" defaultValue={q} placeholder="例: WAUZZZ / S3 / 8V0907404" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="施工種別">
              <Select name="workType" defaultValue={workType}>
                <option value="">すべて</option>
                {Object.entries(workTypeLabels).map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="代理店">
              <Select name="dealerId" defaultValue={dealerId}>
                <option value="">すべて</option>
                {dealers.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="期間（開始）">
              <Input type="date" name="from" defaultValue={from} />
            </Field>
            <Field label="期間（終了）">
              <Input type="date" name="to" defaultValue={to} />
            </Field>
          </div>
          <div className="flex gap-2">
            <Button type="submit">検索</Button>
            <Link
              href="/hq/records"
              className="inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-semibold text-ink-soft hover:bg-surface-2"
            >
              クリア
            </Link>
          </div>
        </form>
      </Card>

      {/* ビュー切替：一覧 ⇄ 顧客別 */}
      <div className="mb-3 flex items-center gap-2">
        <Link
          href={listHref}
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            view !== "customer"
              ? "bg-gold-500 text-white"
              : "border border-line text-ink-soft hover:bg-surface-2"
          }`}
        >
          一覧
        </Link>
        <Link
          href={custHref}
          className={`rounded-full px-3 py-1 text-xs font-semibold ${
            view === "customer"
              ? "bg-gold-500 text-white"
              : "border border-line text-ink-soft hover:bg-surface-2"
          }`}
        >
          顧客別
        </Link>
        {dupTotalRecords > 0 && (
          <span className="ml-auto text-xs font-semibold text-rose-600">
            重複ファイル {dupTotalRecords} 件
          </span>
        )}
      </div>

      {records.length === 0 ? (
        <EmptyState message="該当する施工記録がありません。" />
      ) : view === "customer" ? (
        /* 顧客別ビュー：顧客ごとに案件をまとめる（本店を1店舗として顧客管理） */
        <div className="space-y-2">
          {customerGroups.map((g) => (
            <details key={g.name} className="overflow-hidden rounded-xl border border-line">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 bg-surface-2 px-3 py-2">
                <div className="min-w-0">
                  <span className="text-sm font-bold text-ink">{g.name}</span>
                  <span className="ml-2 text-xs text-ink-soft">{g.recs.length} 件</span>
                  {g.dupCount > 0 && (
                    <span className="ml-2 text-xs font-semibold text-rose-600">
                      重複 {g.dupCount}
                    </span>
                  )}
                </div>
                <span className="shrink-0 text-xs text-ink-soft">
                  最終 {formatDate(g.latest)}
                </span>
              </summary>
              <div className="divide-y divide-line">
                {g.recs.map((r) => {
                  const title = recordTitle(r);
                  return (
                    <Link
                      key={r.id}
                      href={`/hq/records/${r.id}`}
                      className="flex items-center justify-between gap-3 p-3 hover:bg-surface-2"
                    >
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-ink">
                          {title}
                          {r.vin ? (
                            <span className="ml-2 font-mono text-xs text-ink-soft">{r.vin}</span>
                          ) : null}
                        </div>
                        <div className="mt-0.5 text-xs text-ink-soft">
                          {r.dealer.name}・{formatDate(r.workedAt)}
                          {r.calNumber ? `・Cal ${r.calNumber}` : ""}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {isDup(r) && <Badge color="rose">重複</Badge>}
                        {openByRecord.has(r.id) && <Badge color="amber">未返却</Badge>}
                        <Badge color={recordStatusColors[r.status]}>
                          {recordStatusLabels[r.status]}
                        </Badge>
                      </div>
                    </Link>
                  );
                })}
              </div>
            </details>
          ))}
        </div>
      ) : (
        <Card className="divide-y divide-line p-0">
          {records.map((r) => {
            const title = recordTitle(r);
            return (
              <Link
                key={r.id}
                href={`/hq/records/${r.id}`}
                className="flex items-center justify-between gap-3 p-3 hover:bg-surface-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-ink">
                    {title}
                    {r.vin ? (
                      <span className="ml-2 font-mono text-xs text-ink-soft">{r.vin}</span>
                    ) : null}
                  </div>
                  <div className="mt-0.5 text-xs text-ink-soft">
                    {r.customerName ? `${r.customerName}・` : ""}
                    {r.dealer.name}・{formatDate(r.workedAt)}
                    {r.calNumber ? `・Cal ${r.calNumber}` : ""}
                    {!r.calNumber && r.softwareNumber ? `・SW ${r.softwareNumber}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {isDup(r) && <Badge color="rose">重複</Badge>}
                  {openByRecord.has(r.id) && <Badge color="amber">未返却</Badge>}
                  {r.workType && <Badge color="gold">{workTypeLabels[r.workType]}</Badge>}
                  <Badge color={recordStatusColors[r.status]}>
                    {recordStatusLabels[r.status]}
                  </Badge>
                </div>
              </Link>
            );
          })}
        </Card>
      )}
    </div>
  );
}
