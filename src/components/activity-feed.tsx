import { Badge, Card } from "@/components/ui";
import { prisma } from "@/lib/db";
import { tuningContentLabel } from "@/lib/catalog/options";
import { requestStatusLabels, formatDate } from "@/lib/labels";

export type Activity = {
  id: string;
  kind: "download" | "request";
  at: Date;
  dealer: string | null;
  customer: string | null;
  car: string;
  detail: string;
  sub: string;
  workedAt: Date | null; // 初回施工日（記録の施工日）
};

// DL(CatalogDownloadLog)と リクエスト(FileRequest)を統合した活動ログ。
// dealerId 指定で自店のみ（代理店用）、null で全件（本店用）。
async function loadActivity(where: {
  dealerId?: string;
  serviceRecordId?: string;
}): Promise<Activity[]> {
  const [dls, reqs] = await Promise.all([
    prisma.catalogDownloadLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        createdAt: true,
        context: true,
        dealer: { select: { name: true } },
        serviceRecord: {
          select: { carMaker: true, carModel: true, customerName: true, workedAt: true },
        },
        variant: {
          select: {
            stage: true,
            popsAndBangs: true,
            popsSport: true,
            optionTags: true,
            baseFile: { select: { manufacturer: true, model: true } },
          },
        },
      },
    }),
    prisma.fileRequest.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: 200,
      select: {
        id: true,
        createdAt: true,
        title: true,
        status: true,
        dealer: { select: { name: true } },
        serviceRecord: {
          select: { carMaker: true, carModel: true, customerName: true, workedAt: true },
        },
      },
    }),
  ]);

  const items: Activity[] = [];
  for (const d of dls) {
    const car = d.serviceRecord
      ? `${d.serviceRecord.carMaker ?? ""} ${d.serviceRecord.carModel ?? ""}`.trim()
      : d.variant?.baseFile
        ? `${d.variant.baseFile.manufacturer} ${d.variant.baseFile.model}`
        : "";
    const content = d.variant
      ? tuningContentLabel(d.variant.stage, d.variant.popsAndBangs, d.variant.optionTags, d.variant.popsSport)
      : "";
    items.push({
      id: `d${d.id}`,
      kind: "download",
      at: d.createdAt,
      dealer: d.dealer?.name ?? null,
      customer: d.serviceRecord?.customerName ?? null,
      car: car || "（車両不明）",
      detail: content || "ファイル",
      sub: d.context === "HQ_MANUAL" ? "本店DL" : "代理店DL",
      workedAt: d.serviceRecord?.workedAt ?? null,
    });
  }
  for (const r of reqs) {
    const car = r.serviceRecord
      ? `${r.serviceRecord.carMaker ?? ""} ${r.serviceRecord.carModel ?? ""}`.trim()
      : "";
    items.push({
      id: `r${r.id}`,
      kind: "request",
      at: r.createdAt,
      dealer: r.dealer?.name ?? null,
      customer: r.serviceRecord?.customerName ?? null,
      car,
      detail: r.title,
      sub: requestStatusLabels[r.status],
      workedAt: r.serviceRecord?.workedAt ?? null,
    });
  }
  items.sort((a, b) => b.at.getTime() - a.at.getTime());
  return items.slice(0, 300);
}

// 全体（本店=全件 / 代理店=自店）
export async function getActivity(dealerId: string | null): Promise<Activity[]> {
  return loadActivity(dealerId ? { dealerId } : {});
}

// 施工案件ごと（その記録のDL・リクエスト）
export async function getRecordActivity(recordId: string): Promise<Activity[]> {
  return loadActivity({ serviceRecordId: recordId });
}

// 日時を "MM/DD HH:mm" で短く（年は当年なら省略）
function shortDateTime(d: Date): string {
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  const mmdd = `${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")}`;
  const hm = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  return sameYear ? `${mmdd} ${hm}` : `${d.getFullYear()}/${mmdd} ${hm}`;
}

// Excel風の1行テーブル。1画面に多くの行が入るようコンパクトに。
export function ActivityFeed({
  items,
  showDealer,
}: {
  items: Activity[];
  showDealer: boolean;
}) {
  if (items.length === 0) {
    return (
      <Card>
        <p className="py-6 text-center text-sm text-ink-soft">まだ履歴がありません。</p>
      </Card>
    );
  }
  return (
    <Card className="p-0">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[52rem] text-xs">
          <thead className="bg-surface-2 text-left text-[11px] text-ink-soft">
            <tr>
              <th className="px-2 py-1.5 font-semibold">種別</th>
              <th className="px-2 py-1.5 font-semibold">日時</th>
              {showDealer && <th className="px-2 py-1.5 font-semibold">代理店</th>}
              <th className="px-2 py-1.5 font-semibold">顧客名</th>
              <th className="px-2 py-1.5 font-semibold">車両</th>
              <th className="px-2 py-1.5 font-semibold">内容</th>
              <th className="px-2 py-1.5 font-semibold">初回施工日</th>
              <th className="px-2 py-1.5 font-semibold">状態</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {items.map((it) => (
              <tr key={it.id} className="hover:bg-surface-2">
                <td className="whitespace-nowrap px-2 py-1">
                  <Badge color={it.kind === "download" ? "green" : "gold"}>
                    {it.kind === "download" ? "DL" : "依頼"}
                  </Badge>
                </td>
                <td className="whitespace-nowrap px-2 py-1 font-mono text-ink-soft">
                  {shortDateTime(it.at)}
                </td>
                {showDealer && (
                  <td className="max-w-[10rem] truncate px-2 py-1 font-medium text-ink">
                    {it.dealer ?? "—"}
                  </td>
                )}
                <td className="max-w-[9rem] truncate px-2 py-1 text-ink">{it.customer ?? "—"}</td>
                <td className="max-w-[12rem] truncate px-2 py-1 text-ink">{it.car || "—"}</td>
                <td className="max-w-[16rem] truncate px-2 py-1 text-ink" title={it.detail}>
                  {it.detail}
                </td>
                <td className="whitespace-nowrap px-2 py-1 font-mono text-ink-soft">
                  {it.workedAt ? formatDate(it.workedAt) : "—"}
                </td>
                <td className="whitespace-nowrap px-2 py-1 text-ink-soft">{it.sub}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
