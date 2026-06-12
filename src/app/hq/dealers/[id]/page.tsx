import { notFound } from "next/navigation";
import { requireHQ } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { dealerStatusLabels, roleLabels, formatDate } from "@/lib/labels";
import { PageTitle, Card, Badge, Button, LinkButton, EmptyState } from "@/components/ui";
import { updateDealer, toggleDealerStatus } from "@/lib/actions/dealers";
import { DealerForm } from "../dealer-form";
import { AccountIssuer } from "./account-issuer";

export default async function DealerDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireHQ();
  const { id } = await params;

  const dealer = await prisma.dealer.findUnique({
    where: { id },
    include: {
      users: { orderBy: { createdAt: "asc" } },
      _count: { select: { serviceRecords: true, fileRequests: true } },
    },
  });
  if (!dealer) notFound();

  const updateAction = updateDealer.bind(null, dealer.id);
  const toggleAction = toggleDealerStatus.bind(null, dealer.id);

  return (
    <div className="space-y-6">
      <PageTitle
        title={dealer.name}
        subtitle={`施工 ${dealer._count.serviceRecords} 件・依頼 ${dealer._count.fileRequests} 件`}
        action={
          <LinkButton href="/hq/dealers" variant="secondary">
            一覧へ戻る
          </LinkButton>
        }
      />

      {/* ステータス */}
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="text-sm text-ink-soft">現在のステータス</span>
            <Badge color={dealer.status === "ACTIVE" ? "green" : "gray"}>
              {dealerStatusLabels[dealer.status]}
            </Badge>
          </div>
          <form action={toggleAction}>
            <Button type="submit" variant="secondary">
              {dealer.status === "ACTIVE" ? "無効にする" : "有効にする"}
            </Button>
          </form>
        </div>
      </Card>

      {/* 基本情報の編集 */}
      <section>
        <h2 className="mb-2 text-sm font-bold text-ink">基本情報</h2>
        <DealerForm action={updateAction} defaults={dealer} submitLabel="変更を保存" />
      </section>

      {/* 関連リンク */}
      <div className="flex flex-wrap gap-2">
        <LinkButton href={`/hq/records?dealerId=${dealer.id}`} variant="secondary">
          この代理店の施工記録
        </LinkButton>
        <LinkButton href={`/hq/requests?dealerId=${dealer.id}`} variant="secondary">
          この代理店の依頼
        </LinkButton>
      </div>

      {/* ログインアカウント */}
      <section>
        <h2 className="mb-2 text-sm font-bold text-ink">ログインアカウント</h2>
        <Card className="mb-3 p-0">
          {dealer.users.length === 0 ? (
            <div className="p-4">
              <EmptyState message="アカウント未発行です。下から発行できます。" />
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {dealer.users.map((u) => (
                <li key={u.id} className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium text-ink">{u.name}</div>
                    <div className="truncate font-mono text-xs text-ink-soft">{u.email}</div>
                  </div>
                  <div className="text-right text-xs text-ink-soft">
                    <Badge color="gold">{roleLabels[u.role]}</Badge>
                    <div className="mt-1">{formatDate(u.createdAt)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <h3 className="mb-2 text-sm font-medium text-ink">新規アカウント発行</h3>
          <AccountIssuer dealerId={dealer.id} />
        </Card>
      </section>
    </div>
  );
}
