import { requireHQ } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { formatDateTime } from "@/lib/labels";
import { PageTitle, Card, LinkButton } from "@/components/ui";
import { pitAiEnabled } from "@/server/pit/generate";
import { wpConfigured } from "@/server/pit/wordpress";
import { PitAdmin, type StoreRow, type PostRow, type DealerOption, type InviteRow } from "./pit-admin";

export const dynamic = "force-dynamic";

// 本店: mbPIT（施工記録→自動ブログ公開）の管理。店舗マスタ・公開ログ・保留確認・テスト投稿。
export default async function HqPitPage() {
  await requireHQ();

  const [stores, posts, dealers, invites] = await Promise.all([
    prisma.pitStore.findMany({ include: { dealer: { select: { name: true } } }, orderBy: { createdAt: "asc" } }),
    prisma.pitPost.findMany({
      include: { store: { select: { displayName: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.dealer.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.pitInvite.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
  ]);

  const storeRows: StoreRow[] = stores.map((s) => ({
    id: s.id,
    dealerId: s.dealerId,
    dealerName: s.dealer?.name ?? "本店直営",
    displayName: s.displayName,
    slug: s.slug,
    wpCategoryId: s.wpCategoryId,
    footerHtml: s.footerHtml,
    active: s.active,
  }));
  const postRows: PostRow[] = posts.map((p) => ({
    id: p.id,
    storeName: p.store.displayName,
    vehicle: p.vehicle,
    category: p.category,
    status: p.status,
    title: p.title,
    publishedUrl: p.publishedUrl,
    guardResult: p.guardResult,
    errorMessage: p.errorMessage,
    createdAtLabel: formatDateTime(p.createdAt),
  }));
  const dealerOptions: DealerOption[] = dealers.map((d) => ({ id: d.id, name: d.name }));
  const storeNameById = new Map(stores.map((s) => [s.id, s.displayName]));
  const inviteRows: InviteRow[] = invites.map((i) => ({
    id: i.id,
    token: i.token,
    note: i.note,
    used: !!i.usedAt,
    usedByStore: i.storeId ? (storeNameById.get(i.storeId) ?? null) : null,
    createdAtLabel: formatDateTime(i.createdAt),
  }));

  const monthly = await prisma.$queryRaw<{ store: string; ym: string; count: bigint }[]>`
    SELECT s."displayName" AS store, to_char(p."createdAt" AT TIME ZONE 'Asia/Tokyo', 'YYYY-MM') AS ym, count(*) AS count
    FROM "PitPost" p JOIN "PitStore" s ON s.id = p."storeId"
    WHERE p.status = 'published'
    GROUP BY 1, 2 ORDER BY 2 DESC, 1 ASC LIMIT 30`;

  const envOk = { ai: pitAiEnabled(), wp: wpConfigured() };

  return (
    <div>
      <PageTitle
        title="mbPIT 施工記録ブログ"
        subtitle={`${stores.length} 店舗 / 直近 ${posts.length} 件`}
        action={<LinkButton href="/hq/pit/post">🎤 本部から投稿</LinkButton>}
      />
      {(!envOk.ai || !envOk.wp) && (
        <Card className="mb-3 border-red-200 bg-red-50">
          <p className="text-xs text-red-700">
            {!envOk.ai && <>ANTHROPIC_API_KEY が未設定です（AI記事生成が動きません）。 </>}
            {!envOk.wp && <>WP_USER / WP_APP_PASSWORD が未設定です（WordPress公開が動きません）。</>}
            サーバーの .env に設定して再起動してください。
          </p>
        </Card>
      )}
      <PitAdmin
        stores={storeRows}
        posts={postRows}
        dealers={dealerOptions}
        invites={inviteRows}
        monthly={monthly.map((m) => ({ store: m.store, ym: m.ym, count: Number(m.count) }))}
      />
    </div>
  );
}
