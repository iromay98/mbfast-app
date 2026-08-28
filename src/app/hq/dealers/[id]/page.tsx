import { notFound } from "next/navigation";
import { requireHQ } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { dealerStatusLabels, roleLabels, formatDate } from "@/lib/labels";
import { PageTitle, Card, Badge, Button, LinkButton, EmptyState } from "@/components/ui";
import { updateDealer, toggleDealerStatus } from "@/lib/actions/dealers";
import {
  contractStatus,
  formatContractDate,
  renewalLabel,
  toDateInputValue,
  type ContractStatus,
} from "@/lib/contract";
import { DealerForm } from "../dealer-form";
import { AccountIssuer } from "./account-issuer";
import { PitProvisioner } from "./pit-provisioner";
import { suggestStoreSlug } from "@/server/pit/store-slug";
import { DEALER_PLAN } from "@/server/pit/provision";

/** 契約状況の1行サマリ（編集フォームの下に出す） */
function contractSummaryText(s: ContractStatus): string {
  if (!s.startedAt) return "契約開始日が未登録です。入力すると次回更新日を自動で計算します。";
  if (s.endedAt) return `解約済み（${formatContractDate(s.endedAt)}）。更新の案内は出しません。`;
  return `契約開始 ${formatContractDate(s.startedAt)} ／ 次回更新 ${formatContractDate(s.nextRenewalAt)}（${renewalLabel(s)}）／ 更新で${s.termNumber}期目`;
}

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
      pitStore: { select: { id: true, slug: true, displayName: true, wpCategoryId: true, wpPageId: true, active: true, plan: true, serviceTags: true } },
      _count: { select: { serviceRecords: true, fileRequests: true } },
    },
  });
  if (!dealer) notFound();

  const updateAction = updateDealer.bind(null, dealer.id);
  const toggleAction = toggleDealerStatus.bind(null, dealer.id);
  const contract = contractStatus(dealer);

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
        <DealerForm
          action={updateAction}
          defaults={{
            ...dealer,
            // 日付は input[type=date] の形式に変換して渡す（次回更新日は保存せず計算値）
            contractStartedAt: toDateInputValue(dealer.contractStartedAt),
            contractEndedAt: toDateInputValue(dealer.contractEndedAt),
            contractSummary: contractSummaryText(contract),
          }}
          submitLabel="変更を保存"
        />
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

      {/* mbPIT（施工記録の投稿機能）。代理店は無償。未開設なら遡り付与できる */}
      <section>
        <h2 className="mb-2 text-sm font-bold text-ink">mbPIT（施工記録の投稿機能）</h2>
        <Card>
          {dealer.pitStore ? (
            <div className="space-y-2 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge color={dealer.pitStore.active ? "green" : "gray"}>{dealer.pitStore.active ? "開設済み" : "停止中"}</Badge>
                {dealer.pitStore.plan === DEALER_PLAN && <Badge color="gold">代理店（月額免除）</Badge>}
                <span className="font-medium text-ink">{dealer.pitStore.displayName}</span>
                <span className="font-mono text-xs text-ink-soft">/mbpit/{dealer.pitStore.slug}/</span>
              </div>
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-xs text-ink-soft">
                <dt>WPカテゴリ</dt>
                <dd className="font-mono">{dealer.pitStore.wpCategoryId > 0 ? dealer.pitStore.wpCategoryId : "未採番（投稿は採番後に有効）"}</dd>
                <dt>店舗ページ</dt>
                <dd className="font-mono">{dealer.pitStore.wpPageId ?? "未作成"}</dd>
                <dt>ジャンル</dt>
                <dd>{dealer.pitStore.serviceTags || "未設定"}</dd>
              </dl>
              {(dealer.pitStore.wpCategoryId <= 0 || !dealer.pitStore.wpPageId) && (
                <div className="border-t border-line pt-3">
                  <p className="mb-2 text-xs text-ink-soft">WordPress側が未完了です。同じslugで再実行すると続きから作成します。</p>
                  <PitProvisioner dealerId={dealer.id} suggestedSlug={dealer.pitStore.slug} />
                </div>
              )}
              <div className="flex flex-wrap gap-2 pt-1">
                <LinkButton href="/hq/pit" variant="secondary">
                  mbPIT管理（店舗情報・投稿）
                </LinkButton>
              </div>
            </div>
          ) : (
            <div>
              <p className="mb-3 text-sm text-ink-soft">
                この代理店にはまだmbPIT店舗がありません。開設すると店舗カテゴリ・店舗ページが自動で作られ、投稿機能が使えるようになります（代理店は月額免除）。
              </p>
              <PitProvisioner dealerId={dealer.id} suggestedSlug={suggestStoreSlug(dealer.name)} />
            </div>
          )}
        </Card>
      </section>

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
                    <div className="mt-1">
                      {u.passwordChangedAt ? (
                        <Badge color="green">本人がPW変更済み（本部は把握不可）</Badge>
                      ) : (
                        <Badge color="gray">初期PWのまま</Badge>
                      )}
                    </div>
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
