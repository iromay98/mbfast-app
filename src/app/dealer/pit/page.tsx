import type { Metadata } from "next";
import { pitMetadata } from "@/lib/pit-metadata";
import { requireDealer, getSessionUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/labels";
import { PageTitle, Card } from "@/components/ui";
import { storeStats } from "@/server/pit/gamification";
import { StoreInfoEditor } from "@/components/store-info-editor";
import { PitPostForm } from "./pit-post-form";
import { PostList } from "./post-list";

export const dynamic = "force-dynamic";

// mbPIT専用アカウントにはタブタイトルにもmbFASTを出さない（別ブランド運用）
export async function generateMetadata(): Promise<Metadata> {
  const user = await getSessionUser();
  if (user?.dealerId) {
    const d = await prisma.dealer.findUnique({
      where: { id: user.dealerId },
      select: { pitOnly: true },
    });
    if (d?.pitOnly) return pitMetadata("mbPIT 施工記録の投稿");
  }
  return {};
}

// 店舗（mbPIT加盟店）: 施工記録の投稿 → AIが記事化して mbfasttuning.com に自動公開。
export default async function DealerPitPage({
  searchParams,
}: {
  // ?from=<PitPost.id> … 施工証明のスタンバイ下書きから「投稿する」で来たとき
  searchParams: Promise<{ from?: string; preview?: string }>;
}) {
  const user = await requireDealer();
  const { from, preview } = await searchParams;

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
      lineUrl: true,
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
      editNote: true,
      publishedUrl: true,
      createdAt: true,
      // 公開前確認（review）の本文を確認画面で読めるようにする
      bodyHtml: true,
    },
  });

  // 施工証明のスタンバイ下書きから来たとき、その下書き(自店・draft)を読んで車種・カテゴリを引き継ぐ
  const staged = from
    ? await prisma.pitPost.findFirst({
        where: { id: from, storeId: store.id, status: "draft" },
        select: { id: true, vehicle: true, category: true },
      })
    : null;

  const stats = await storeStats(store.id);
  // mbPIT専用アカウントは下タブに「ホーム」「店舗」があるので、この画面では投稿に集中させる
  // （実績サマリー・店舗情報編集はそれぞれのタブに置いてある）
  const dealer = await prisma.dealer.findUnique({
    where: { id: user.dealerId },
    select: { pitOnly: true },
  });
  const pitOnly = !!dealer?.pitOnly;

  return (
    <div className="space-y-4">
      <PageTitle
        title="施工ブログ投稿"
        subtitle={`${store.displayName} — 写真を送ると数分でブログ記事になります`}
      />

      {/* ゲーミフィケーション: 主表示は「先月の自分」との比較。順位は副次表示 */}
      <div className={`grid grid-cols-3 gap-2 ${pitOnly ? "hidden" : ""}`}>
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
        <PitPostForm
          stagedPostId={staged?.id}
          initialVehicle={staged?.vehicle}
          initialCategory={staged?.category}
        />
      </Card>

      {/* 店舗情報の自己編集（mbPIT専用アカウントは「店舗」タブに独立ページがあるので出さない） */}
      <Card className={pitOnly ? "hidden" : ""}>
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
                lineUrl: store.lineUrl,
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
        <PostList
          initialPreviewId={preview}
          posts={posts.map((p) => ({
            id: p.id,
            vehicle: p.vehicle,
            status: p.status,
            title: p.title,
            editNote: p.editNote,
            publishedUrl: p.publishedUrl,
            createdAtLabel: formatDateTime(p.createdAt),
            // 本文は確認待ちのときだけ渡す（公開済みの本文をクライアントに載せない）
            bodyHtml: p.status === "review" ? p.bodyHtml : null,
          }))}
        />
      </Card>
    </div>
  );
}
