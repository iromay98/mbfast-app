import { requireHQ } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { PageTitle, Card, LinkButton } from "@/components/ui";
import { HqPitPostClient } from "./post-client";

export const dynamic = "force-dynamic";

// 本部: 施工記録の投稿（代理店と同じ音声投稿フォーム）。
// どの店舗として投稿するかを選べる（本店直営店舗・代理店の代行投稿の両方に対応）。
export default async function HqPitPostPage() {
  await requireHQ();

  const stores = await prisma.pitStore.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, displayName: true, active: true, dealerId: true },
  });

  return (
    <div className="space-y-4">
      <PageTitle
        title="施工ブログ投稿（本部）"
        subtitle="店舗を選んで投稿すると、その店舗の記事として公開されます"
        action={
          <LinkButton href="/hq/pit" variant="secondary">
            管理画面へ
          </LinkButton>
        }
      />
      {stores.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-soft">
            店舗が未登録です。先に「mbPIT 管理」の店舗マスタで店舗を登録してください（本店直営の場合は代理店を紐づけずに登録できます）。
          </p>
        </Card>
      ) : (
        <HqPitPostClient stores={stores} />
      )}
    </div>
  );
}
