import { requireHQ } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { formatDate, formatDateTime } from "@/lib/labels";
import { PageTitle, Card, LinkButton } from "@/components/ui";
import { pitAiEnabled } from "@/server/pit/generate";
import { wpConfigured, fetchPostState } from "@/server/pit/wordpress";
import { pickStoreInfo } from "@/server/pit/store-meta";
import { PitAdmin, type StoreRow, type PostRow, type DealerOption } from "./pit-admin";

export const dynamic = "force-dynamic";

// 本店: mbPIT（施工記録→自動ブログ公開）の管理。店舗マスタ・公開ログ・保留確認・テスト投稿。
export default async function HqPitPage() {
  await requireHQ();

  const [stores, posts, dealers, postCounts, lastLogs] = await Promise.all([
    prisma.pitStore.findMany({ include: { dealer: { select: { name: true } } }, orderBy: { createdAt: "asc" } }),
    prisma.pitPost.findMany({
      // 施工証明から用意しただけのスタンバイ下書きは投稿ではないので本部の一覧に出さない
      where: { status: { not: "draft" } },
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
      certBrandName: s.certBrandName,
      certShowCustomerName: s.certShowCustomerName,
      certShowCustomerAddress: s.certShowCustomerAddress,
      certShowCustomerTel: s.certShowCustomerTel,
      certShowAmount: s.certShowAmount,
      postReviewRequired: s.postReviewRequired,
      certificationNo: s.certificationNo,
      certCount: certCountByStore.get(s.id) ?? 0,
      keepUntilLabel: keepUntilByStore.get(s.id)
        ? formatDate(keepUntilByStore.get(s.id)!)
        : null,
      // 同期対象の項目は定義（STORE_META_FIELDS）から抜き出す＝項目追加に自動追随
      info: pickStoreInfo(s),
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
    photoCount: Array.isArray(p.photoKeys) ? p.photoKeys.length : 0,
    createdAtLabel: formatDateTime(p.createdAt),
    // 本文プレビューは公開前確認（review）の記事だけ渡す（一覧ペイロードを重くしない）
    bodyHtml: p.status === "review" ? p.bodyHtml : null,
    editNote: p.editNote ?? "",
    vehicleLabel: p.vehicle,
  }));

  /*
   * 公開前確認（review）で止まっている投稿のWP側の実状態を先に引く。
   * WP管理画面で人がゴミ箱に入れた記事があるため（重複掃除で実際に発生）、
   * 「公開できる下書き」と「掃除済み」を本部が取り違えないように出す。
   * 件数は通常ひと桁なので同期的に取ってよい（失敗しても画面は出す）。
   */
  const reviewPosts = posts.filter((p) => p.status === "review");
  const wpStates = new Map<string, string>();
  if (wpConfigured() && reviewPosts.length > 0) {
    const states = await Promise.all(
      reviewPosts.map(async (p) =>
        p.wpPostId ? ([p.id, (await fetchPostState(p.wpPostId))?.status ?? "unknown"] as const) : ([p.id, "none"] as const),
      ),
    );
    for (const [id, st] of states) wpStates.set(id, st);
  }
  for (const row of postRows) {
    const st = wpStates.get(row.id);
    if (st) row.wpState = st;
  }
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
