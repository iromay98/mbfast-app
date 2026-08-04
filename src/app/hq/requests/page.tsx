import Link from "next/link";
import { requireHQ } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { requestStatusLabels, formatDate } from "@/lib/labels";
import { PageTitle, Card, Button, Select, Field } from "@/components/ui";
import { RequestTable, type RequestRow } from "@/components/request-table";
import { RestoreScroll } from "@/components/restore-scroll";
import type { Prisma } from "@/generated/prisma/client";

type SP = Record<string, string | string[] | undefined>;
function one(v: string | string[] | undefined): string {
  return (Array.isArray(v) ? v[0] : v) ?? "";
}

export default async function HQRequestsPage({
  searchParams,
}: {
  searchParams: Promise<SP>;
}) {
  await requireHQ();
  const sp = await searchParams;
  const status = one(sp.status);
  const dealerId = one(sp.dealerId);

  const where: Prisma.FileRequestWhereInput = {};
  if (status && status in requestStatusLabels) {
    where.status = status as keyof typeof requestStatusLabels;
  }
  if (dealerId) where.dealerId = dealerId;

  const [dealers, requests] = await Promise.all([
    prisma.dealer.findMany({ orderBy: { name: "asc" }, select: { id: true, name: true } }),
    prisma.fileRequest.findMany({
      where,
      // 重要（★）を最上位に固定。同じ重要度の中では更新が新しい順
      orderBy: [{ priority: "desc" }, { updatedAt: "desc" }],
      select: {
        id: true,
        title: true,
        requestNote: true,
        status: true,
        priority: true,
        resultFilePath: true,
        updatedAt: true,
        dealer: { select: { name: true } },
        serviceRecord: { select: { carMaker: true, carModel: true, customerName: true } },
      },
    }),
  ]);

  const rows: RequestRow[] = requests.map((r) => ({
    id: r.id,
    dealer: r.dealer?.name ?? null,
    customer: r.serviceRecord?.customerName ?? null,
    car: `${r.serviceRecord?.carMaker ?? ""} ${r.serviceRecord?.carModel ?? ""}`.trim(),
    title: r.title,
    content: r.requestNote?.match(/「(.+?)」/)?.[1] ?? null,
    status: r.status,
    priority: r.priority,
    autoDelivered: r.status === "DELIVERED" && !r.resultFilePath,
    updatedAtLabel: formatDate(r.updatedAt),
  }));

  /*
   * 「対応中」を別枠にする。未返却（リクエスト/作業中）は流れの中で見落としやすく、
   * 納品済みと同じ表に混ぜると埋もれるため。絞り込みでステータスを指定しているときは
   * 利用者が意図して1状態だけ見ているので、別枠は出さず1つの表にする。
   */
  const openRows = status ? [] : rows.filter((r) => r.status === "RECEIVED" || r.status === "IN_PROGRESS");
  const doneRows = status ? rows : rows.filter((r) => !openRows.includes(r));

  return (
    <div>
      <PageTitle title="依頼管理（全店）" subtitle={`${requests.length} 件`} />

      <Card className="mb-4">
        <form method="get" className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Field label="ステータス">
            <Select name="status" defaultValue={status}>
              <option value="">すべて</option>
              {Object.entries(requestStatusLabels).map(([v, label]) => (
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
          <div className="flex gap-2">
            <Button type="submit">絞り込み</Button>
            <Link
              href="/hq/requests"
              className="inline-flex min-h-11 items-center rounded-lg px-4 text-sm font-semibold text-ink-soft hover:bg-surface-2"
            >
              クリア
            </Link>
          </div>
        </form>
      </Card>

      {openRows.length > 0 && (
        <div className="mb-5">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-bold text-ink">
            対応中の依頼
            <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800">
              {openRows.length}
            </span>
            <span className="text-xs font-normal text-ink-soft">
              ★を押すと最上位に固定できます
            </span>
          </h2>
          <RequestTable rows={openRows} forHQ hrefBase="/hq/requests" />
        </div>
      )}

      {doneRows.length > 0 && (
        <div>
          {openRows.length > 0 && (
            <h2 className="mb-2 text-sm font-bold text-ink-soft">
              完了・キャンセル（{doneRows.length}）
            </h2>
          )}
          <RequestTable rows={doneRows} forHQ hrefBase="/hq/requests" />
        </div>
      )}
      {rows.length === 0 && <RequestTable rows={[]} forHQ hrefBase="/hq/requests" />}

      {/* 詳細から戻ったとき、さっき見ていた位置に戻す */}
      <RestoreScroll storageKey="hq-requests" />
    </div>
  );
}
