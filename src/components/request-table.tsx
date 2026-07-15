import Link from "next/link";
import { Card, EmptyState } from "@/components/ui";
import { formatDate } from "@/lib/labels";

export type RequestRow = {
  id: string;
  customer: string | null;
  car: string;
  title: string;
  content: string | null; // リクエスト内容（「Stage1・バブリング」等）
  status: "RECEIVED" | "IN_PROGRESS" | "DELIVERED" | "CANCELLED";
  autoDelivered: boolean; // 納品(自動)か
  dealer?: string | null; // 本店表示用
  updatedAtLabel: string;
};

// 状態の表示: 本店＝リクエスト/作業中/納品/納品(自動)/キャンセル、
// 代理店＝待機中/納品(DL可能)/キャンセル。
function statusView(r: RequestRow, forHQ: boolean): { label: string; cls: string } {
  if (r.status === "CANCELLED") return { label: "キャンセル", cls: "bg-surface-2 text-ink-soft" };
  if (r.status === "DELIVERED") {
    if (forHQ)
      return r.autoDelivered
        ? { label: "納品(自動)", cls: "bg-sky-100 text-sky-700" }
        : { label: "納品済み", cls: "bg-green-100 text-green-700" };
    return { label: "納品（DL可能）", cls: "bg-green-100 text-green-700" };
  }
  if (r.status === "IN_PROGRESS")
    return forHQ
      ? { label: "作業中", cls: "bg-amber-100 text-amber-700" }
      : { label: "作業待ち", cls: "bg-amber-100 text-amber-700" };
  // RECEIVED
  return forHQ
    ? { label: "リクエスト", cls: "bg-rose-100 text-rose-700" }
    : { label: "リクエスト中（待機）", cls: "bg-rose-100 text-rose-700" };
}

export function RequestTable({
  rows,
  forHQ,
  hrefBase,
}: {
  rows: RequestRow[];
  forHQ: boolean;
  hrefBase: string; // "/hq/requests" or "/dealer/requests"
}) {
  if (rows.length === 0) {
    return <EmptyState message="該当する依頼がありません。" />;
  }
  return (
    <Card className="p-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[46rem] text-xs">
          <thead className="bg-surface-2 text-left text-[11px] text-ink-soft">
            <tr>
              {forHQ && <th className="px-2 py-1.5 font-semibold">代理店</th>}
              <th className="px-2 py-1.5 font-semibold">顧客名</th>
              <th className="px-2 py-1.5 font-semibold">車両</th>
              <th className="px-2 py-1.5 font-semibold">リクエスト内容</th>
              <th className="px-2 py-1.5 font-semibold">状態</th>
              <th className="px-2 py-1.5 font-semibold">更新</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((r) => {
              const st = statusView(r, forHQ);
              return (
                <tr key={r.id} className="hover:bg-surface-2">
                  {forHQ && (
                    <td className="max-w-[9rem] truncate px-2 py-1.5 font-medium text-ink">
                      {r.dealer ?? "—"}
                    </td>
                  )}
                  <td className="max-w-[8rem] truncate px-2 py-1.5 text-ink">{r.customer ?? "—"}</td>
                  <td className="max-w-[11rem] truncate px-2 py-1.5 text-ink">{r.car || "—"}</td>
                  <td className="max-w-[16rem] truncate px-2 py-1.5 text-ink">
                    <Link href={`${hrefBase}/${r.id}`} className="text-gold-700 hover:underline">
                      {r.content || r.title}
                    </Link>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${st.cls}`}>
                      {st.label}
                    </span>
                  </td>
                  <td className="whitespace-nowrap px-2 py-1.5 font-mono text-ink-soft">
                    {r.updatedAtLabel}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
