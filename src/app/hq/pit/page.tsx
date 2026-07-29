import { requireHQ } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { formatDate, formatDateTime } from "@/lib/labels";
import { PageTitle, Card, LinkButton } from "@/components/ui";
import { pitAiEnabled } from "@/server/pit/generate";
import { wpConfigured } from "@/server/pit/wordpress";
import { PitAdmin, type StoreRow, type PostRow, type DealerOption } from "./pit-admin";

export const dynamic = "force-dynamic";

// 本店: mbPIT（施工記録→自動ブログ公開）の管理。店舗マスタ・公開ログ・保留確認・テスト投稿。
export default async function HqPitPage() {
  await requireHQ();

  const [stores, posts, dealers, postCounts, lastLogs] = await Promise.all([
    prisma.pitStore.findMany({ include: { dealer: { select: { name: true } } }, orderBy: { createdAt: "asc" } }),
    prisma.pitPost.findMany({
      include: { store: { select: { displayName: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.dealer.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.pitPost.groupBy({ by: ["storeId"], where: { status: "published" }, _count: true }),
    // 店舗ごとの直近同期ログ（skipped/dry-runは状態表示に関係ないので除外）
    prisma.pitStoreSyncLog.findMany({
      where: { status: { in: ["success", "failed", "ingest"] } },
      orderBy: { createdAt: "desc" },
      distinct: ["storeId"],
      select: { storeId: true, status: true },
    }),
  ]);

  // 記録（施工証明書）の件数と最長保存期限。停止前に「消さない・保存義務が残る」を伝えるために出す
  const [certCounts, keepUntils] = await Promise.all([
    prisma.pitCertificate.groupBy({
      by: ["storeId"],
      where: { status: { in: ["issued", "voided"] } },
      _count: true,
    }),
    prisma.pitCertificate.groupBy({
      by: ["storeId"],
      where: { retentionUntil: { not: null } },
      _max: { retentionUntil: true },
    }),
  ]);
  const certCountByStore = new Map(certCounts.map((c) => [c.storeId, c._count]));
  const keepUntilByStore = new Map(keepUntils.map((k) => [k.storeId, k._max.retentionUntil]));

  const countByStore = new Map(postCounts.map((c) => [c.storeId, c._count]));
  const lastLogByStore = new Map(lastLogs.map((l) => [l.storeId, l.status]));

  const storeRows: StoreRow[] = stores.map((s) => {
    const lastLog = lastLogByStore.get(s.id);
    const syncBadge: StoreRow["syncBadge"] = !s.lastSyncedAt
      ? lastLog === "failed"
        ? "failed"
        : "none"
      : lastLog === "failed"
        ? "failed"
        : // lastSyncedAt更新自体が@updatedAtを動かすため、5秒の許容差を見て「アプリ側が新しい」を判定
          s.updatedAt.getTime() - s.lastSyncedAt.getTime() > 5000
          ? "stale"
          : "ok";
    return {
      id: s.id,
      dealerId: s.dealerId,
      dealerName: s.dealer?.name ?? "本店直営",
      displayName: s.displayName,
      slug: s.slug,
      wpCategoryId: s.wpCategoryId,
      footerHtml: s.footerHtml,
      active: s.active,
      facilityType: s.facilityType,
      certificationNo: s.certificationNo,
      certCount: certCountByStore.get(s.id) ?? 0,
      keepUntilLabel: keepUntilByStore.get(s.id)
        ? formatDate(keepUntilByStore.get(s.id)!)
        : null,
      info: {
        area: s.area,
        address: s.address,
        hours: s.hours,
        closedDays: s.closedDays,
        tel: s.tel,
        email: s.email,
        website: s.website,
        serviceTags: s.serviceTags,
        intro: s.intro,
      },
      contactPerson: s.contactPerson,
      internalNote: s.internalNote,
      postCount: countByStore.get(s.id) ?? 0,
      lastSyncedLabel: s.lastSyncedAt ? `最終同期: ${formatDateTime(s.lastSyncedAt)}` : null,
      syncBadge,
    };
  });
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
        monthly={monthly.map((m) => ({ store: m.store, ym: m.ym, count: Number(m.count) }))}
      />
    </div>
  );
}
