/*
 * 加盟店向け・自店のGoogle表示実績（キャッシュ付き）。
 *
 * 加盟店ホームで**自動表示**する。開くたびにGoogleへ問い合わせると
 * 遅いうえAPI割り当てを消費するので、1日1回だけ取得してDBに置き、
 * それ以内の再訪はキャッシュを返す。
 *
 * 取得失敗（未連携・トークン失効・API未有効など）は null を返して
 * ホームでは単に非表示にする。ホームはエラーを見せる場所ではない
 * （連携の問題は /dealer/pit/gbp 側で案内する）。
 */
import { prisma } from "@/lib/db";
import { fetchPerformanceSummary } from "@/server/pit/gbp/performance";
import { accessTokenFor } from "@/server/pit/gbp/self-auth";
import { decryptToken } from "@/server/pit/gbp/token-crypto";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export type StorePerf = { label: string; total: number }[];

export async function storePerformanceCached(storeId: string): Promise<StorePerf | null> {
  const store = await prisma.pitStore.findUnique({
    where: { id: storeId },
    select: {
      gbpLocationId: true,
      gbpAuthMode: true,
      gbpRefreshTokenEnc: true,
      gbpPerfCache: true,
      gbpPerfCachedAt: true,
    },
  });
  if (!store?.gbpLocationId) return null;

  const fresh =
    store.gbpPerfCachedAt && Date.now() - store.gbpPerfCachedAt.getTime() < CACHE_TTL_MS;
  if (fresh && Array.isArray(store.gbpPerfCache)) {
    return store.gbpPerfCache as StorePerf;
  }

  try {
    let token: string | undefined;
    if (store.gbpAuthMode === "SELF") {
      const refresh = decryptToken(store.gbpRefreshTokenEnc);
      if (!refresh) return null;
      token = await accessTokenFor(refresh);
    }
    const rows = await fetchPerformanceSummary(store.gbpLocationId, 30, token);
    const slim: StorePerf = rows.map((r) => ({ label: r.label, total: r.total }));
    await prisma.pitStore.update({
      where: { id: storeId },
      data: { gbpPerfCache: slim, gbpPerfCachedAt: new Date() },
    });
    return slim;
  } catch {
    // 失敗時: 期限切れでも古いキャッシュがあればそれを出す（無いよりまし）
    if (Array.isArray(store.gbpPerfCache)) return store.gbpPerfCache as StorePerf;
    return null;
  }
}
