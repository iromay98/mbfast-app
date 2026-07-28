import { requireDealer } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/labels";
import { PageTitle, Card } from "@/components/ui";
import { storeStats } from "@/server/pit/gamification";
import { StoreInfoEditor } from "@/components/store-info-editor";
import { PitPostForm } from "./pit-post-form";

export const dynamic = "force-dynamic";

// 店舗（mbPIT加盟店）: 施工記録の投稿 → AIが記事化して mbfasttuning.com に自動公開。
export default async function DealerPitPage() {
  const user = await requireDealer();

  const store = await prisma.pitStore.findUnique({
    where: { dealerId: user.dealerId },
    select: {
      id: true,
      displayName: true,
      slug: true,
      active: true,
      area: true,
      address: true,
      hours: true,
      closedDays: true,
      tel: true,
      email: true,
      website: true,
      serviceTags: true,
      intro: true,
    },
  });

  if (!store || !store.active) {
    return (
      <div>
        <PageTitle title="施工ブログ投稿" />
        <Card>
          <p className="text-sm text-ink-soft">
            この店舗はまだブログ投稿の対象になっていません。本部にお問い合わせください。
          </p>
        </Card>
      </div>
    );
  }

  const posts = await prisma.pitPost.findMany({
    where: { storeId: store.id },
    orderBy: { createdAt: "desc" },
    take: 20,
    select: {
      id: true,
      vehicle: true,
      category: true,
      status: true,
      title: true,
      publishedUrl: true,
      createdAt: true,
    },
  });

  const stats = await storeStats(store.id);

  return (
    <div className="space-y-4">
      <PageTitle
        title="施工ブログ投稿"
        subtitle={`${store.displayName} — 写真を送ると数分でブログ記事になります`}
      />

      {/* ゲーミフィケーション: 主表示は「先月の自分」との比較。順位は副次表示 */}
      <div className="grid grid-cols-3 gap-2">
        <Card className="p-3 text-center">
          <div className="text-xl font-black text-gold-600">{stats.total}</div>
          <div className="text-[10px] font-semibold text-ink-soft">通算記録</div>
          {stats.badge && (
            <div className="mt-1 text-[10px] font-bold text-gold-700">
              {stats.badge.emoji} {stats.badge.name}店
            </div>
          )}
        </Card>
        <Card className="p-3 text-center">
          <div className="text-xl font-black text-ink">{stats.month}</div>
          <div className="text-[10px] font-semibold text-ink-soft">今月（先月{stats.lastMonth}件）</div>
          {stats.rank && stats.storeCount > 1 && (
            <div className="mt-1 text-[10px] text-ink-soft">
              加盟{stats.storeCount}店中 {stats.rank}位
            </div>
          )}
        </Card>
        <Card className="p-3 text-center">
          <div className="text-xl font-black text-orange-600">
            {stats.streakWeeks > 0 ? `🔥${stats.streakWeeks}` : "—"}
          </div>
          <div className="text-[10px] font-semibold text-ink-soft">週連続投稿</div>
          {stats.next && (
            <div className="mt-1 text-[10px] text-ink-soft">
              {stats.next.name}まで{stats.next.remaining}件
            </div>
          )}
        </Card>
      </div>

      <Card>
        <PitPostForm />
      </Card>

      {/* 店舗情報の自己編集（HPの店舗ページ・カードに表示される内容。保存→差分確認→即反映） */}
      <Card>
        <details>
          <summary className="cursor-pointer text-sm font-bold text-ink">
            🏪 店舗情報を編集（所在地・営業時間などHPに表示される内容）
          </summary>
          <StoreInfoEditor
            scope="self"
            store={{
              id: store.id,
              displayName: store.displayName,
              slug: store.slug,
              active: store.active,
              info: {
                area: store.area,
                address: store.address,
                hours: store.hours,
                closedDays: store.closedDays,
                tel: store.tel,
                email: store.email,
                website: store.website,
                serviceTags: store.serviceTags,
                intro: store.intro,
              },
              contactPerson: "",
              internalNote: "",
            }}
          />
        </details>
      </Card>

      <Card>
        <h3 className="mb-2 text-sm font-bold text-ink">これまでの投稿（直近{posts.length}件）</h3>
        {posts.length === 0 ? (
          <p className="text-xs text-ink-soft">まだ投稿がありません。</p>
        ) : (
          <div className="divide-y divide-line">
            {posts.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-2 py-2 text-xs">
                <span className="text-ink-soft">{formatDateTime(p.createdAt)}</span>
                <span className="font-semibold">{p.vehicle}</span>
                <StatusBadge status={p.status} />
                {p.publishedUrl ? (
                  <a
                    href={p.publishedUrl}
                    target="_blank"
                    rel="noopener"
                    className="max-w-[16rem] truncate text-sky-700 hover:underline"
                  >
                    {p.title ?? "記事を見る"}
                  </a>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    published: { label: "公開済み", cls: "bg-green-100 text-green-800" },
    held: { label: "本部確認中", cls: "bg-amber-100 text-amber-800" },
    failed: { label: "失敗", cls: "bg-surface-2 text-ink-soft" },
    processing: { label: "処理中", cls: "bg-sky-100 text-sky-800" },
  };
  const st = map[status] ?? { label: status, cls: "bg-surface-2" };
  return <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${st.cls}`}>{st.label}</span>;
}
