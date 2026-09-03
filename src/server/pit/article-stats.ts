/*
 * 加盟店向け・自店記事の閲覧実績（キャッシュ付き）。
 * gbp/store-performance.ts と同じ思想: ホームで自動表示するため
 * 1日1回だけGA4へ取得してDBに置く。失敗は古い値、無ければ非表示。
 */
import { prisma } from "@/lib/db";
import { ga4Configured, fetchStoreArticleStats, type StoreArticleStats } from "@/server/pit/ga4";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export async function storeArticleStatsCached(storeId: string): Promise<StoreArticleStats | null> {
  if (!ga4Configured()) return null;
  const store = await prisma.pitStore.findUnique({
    where: { id: storeId },
    select: { slug: true, ga4Cache: true, ga4CachedAt: true },
  });
  if (!store?.slug) return null;
  const fresh = store.ga4CachedAt && Date.now() - store.ga4CachedAt.getTime() < CACHE_TTL_MS;
  if (fresh && store.ga4Cache && typeof store.ga4Cache === "object") {
    return store.ga4Cache as StoreArticleStats;
  }
  try {
    const stats = await fetchStoreArticleStats(store.slug);
    await prisma.pitStore.update({
      where: { id: storeId },
      data: { ga4Cache: stats as object, ga4CachedAt: new Date() },
    });
    return stats;
  } catch {
    if (store.ga4Cache && typeof store.ga4Cache === "object") return store.ga4Cache as StoreArticleStats;
    return null;
  }
}
