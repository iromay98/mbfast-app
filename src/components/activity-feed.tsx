import { Badge, Card } from "@/components/ui";
import { prisma } from "@/lib/db";
import { tuningContentLabel } from "@/lib/catalog/options";
import { requestStatusLabels, formatDateTime } from "@/lib/labels";

export type Activity = {
  id: string;
  kind: "download" | "request";
  at: Date;
  dealer: string | null;
  car: string;
  detail: string;
  sub: string;
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
      take: 150,
      select: {
        id: true,
        createdAt: true,
        context: true,
        dealer: { select: { name: true } },
        serviceRecord: { select: { carMaker: true, carModel: true } },
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
      take: 150,
      select: {
        id: true,
        createdAt: true,
        title: true,
        status: true,
        dealer: { select: { name: true } },
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
      car: car || "（車両不明）",
      detail: content || "ファイル",
      sub: d.context === "HQ_MANUAL" ? "本店DL" : "代理店DL",
    });
  }
  for (const r of reqs) {
    items.push({
      id: `r${r.id}`,
      kind: "request",
      at: r.createdAt,
      dealer: r.dealer?.name ?? null,
      car: "",
      detail: r.title,
      sub: requestStatusLabels[r.status],
    });
  }
  items.sort((a, b) => b.at.getTime() - a.at.getTime());
  return items.slice(0, 200);
}

// 全体（本店=全件 / 代理店=自店）
export async function getActivity(dealerId: string | null): Promise<Activity[]> {
  return loadActivity(dealerId ? { dealerId } : {});
}

// 施工案件ごと（その記録のDL・リクエスト）
export async function getRecordActivity(recordId: string): Promise<Activity[]> {
  return loadActivity({ serviceRecordId: recordId });
}

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
      <div className="divide-y divide-line">
        {items.map((it) => (
          <div key={it.id} className="flex items-center justify-between gap-3 px-3 py-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <Badge color={it.kind === "download" ? "green" : "gold"}>
                  {it.kind === "download" ? "ダウンロード" : "リクエスト"}
                </Badge>
                <span className="truncate text-sm font-medium text-ink">
                  {it.car ? `${it.car}・` : ""}
                  {it.detail}
                </span>
              </div>
              <div className="mt-0.5 truncate text-xs text-ink-soft">
                {showDealer && it.dealer ? `${it.dealer}・` : ""}
                {formatDateTime(it.at)}
                {it.sub ? `・${it.sub}` : ""}
              </div>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}
