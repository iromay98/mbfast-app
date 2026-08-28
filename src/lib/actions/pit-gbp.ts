"use server";

import { revalidatePath } from "next/cache";
import { requireHQ } from "@/lib/authz";
import { prisma } from "@/lib/db";
import {
  linkStoreToLocation,
  unlinkStore,
  setGbpPostingEnabled,
  type LinkInput,
} from "@/server/pit/gbp/link";

const PATH = "/hq/pit/gbp";

/*
 * Googleマップ投稿の紐付け操作。本部のみ。
 * 加盟店には触らせない（誤配信すると相手の資産に影響が出るため本部の責任で行う）。
 */
export async function linkGbpLocation(input: LinkInput): Promise<{ ok?: true; error?: string }> {
  const user = await requireHQ();
  const r = await linkStoreToLocation(input, user.id);
  if (r.ok) revalidatePath(PATH);
  return r;
}

export async function unlinkGbpLocation(storeId: string): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  const r = await unlinkStore(storeId);
  if (r.ok) revalidatePath(PATH);
  return r;
}

export async function toggleGbpPosting(
  storeId: string,
  enabled: boolean,
): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  const r = await setGbpPostingEnabled(storeId, enabled);
  if (r.ok) revalidatePath(PATH);
  return r;
}

/*
 * マップ投稿のGoogle側の実状態を取得する（本部のみ）。
 *
 * GBPの投稿は受理された後に審査が走り、PROCESSING（審査中）→LIVE（公開）
 * または REJECTED（非公開）になる。DBのposted記録だけでは「マップに出ているか」が
 * 分からない（2026-08-28 実際に PROCESSING のまま見えない事例が出た）ため、
 * 直近の投稿記録とGoogleの状態を突き合わせて返す。
 *
 * 呼ぶたびにGBP APIへ問い合わせる＝ボタン押下時のみ実行（自動ポーリングしない。
 * 割り当てを無駄に消費しないため）。
 */
export async function fetchGbpPostStates(): Promise<{
  ok?: true;
  error?: string;
  rows?: {
    postId: string;
    title: string;
    storeName: string;
    postedAt: string | null;
    state: string; // LIVE / PROCESSING / REJECTED / NOT_FOUND / FAILED
    gbpError: string | null;
  }[];
}> {
  await requireHQ();
  const posts = await prisma.pitPost.findMany({
    where: {
      status: "published",
      OR: [{ gbpPostName: { not: null } }, { gbpError: { not: null } }],
    },
    orderBy: { createdAt: "desc" },
    take: 10,
    select: {
      id: true,
      title: true,
      gbpPostName: true,
      gbpPostedAt: true,
      gbpError: true,
      store: {
        select: { displayName: true, gbpAccountId: true, gbpLocationId: true },
      },
    },
  });

  // ロケーションごとに1回だけ一覧を取り、投稿名→stateの索引を作る
  const { listLocalPosts } = await import("@/server/pit/gbp/client");
  const stateByName = new Map<string, string>();
  const seen = new Set<string>();
  for (const p of posts) {
    const loc = p.store.gbpLocationId;
    if (!loc || seen.has(loc)) continue;
    seen.add(loc);
    try {
      const { posts: gbpPosts } = await listLocalPosts(p.store.gbpAccountId, loc, 20);
      for (const g of gbpPosts) if (g.name) stateByName.set(g.name, g.state ?? "UNKNOWN");
    } catch {
      // 取得失敗はその店の投稿を UNKNOWN 扱いにする（画面には出す）
    }
  }

  return {
    ok: true,
    rows: posts.map((p) => ({
      postId: p.id,
      title: p.title ?? "(無題)",
      storeName: p.store.displayName,
      postedAt: p.gbpPostedAt ? p.gbpPostedAt.toISOString() : null,
      state: p.gbpPostName
        ? (stateByName.get(p.gbpPostName) ?? "NOT_FOUND")
        : "FAILED",
      gbpError: p.gbpError,
    })),
  };
}

/*
 * 店舗のGoogleマップ・検索での表示実績を取得（本部のみ）。
 * 方式Bの店はその店のトークンで取得する。
 * 未有効化(403)は「Cloud ConsoleでPerformance APIを有効化」の案内に変換する。
 */
export async function fetchGbpPerformance(
  storeId: string,
  daysBack: number,
): Promise<{ ok?: true; error?: string; rows?: { label: string; total: number }[] }> {
  await requireHQ();
  if (![30, 90].includes(daysBack)) return { error: "期間は30日か90日を指定してください" };
  const store = await prisma.pitStore.findUnique({
    where: { id: storeId },
    select: {
      gbpLocationId: true,
      gbpAuthMode: true,
      gbpRefreshTokenEnc: true,
    },
  });
  if (!store?.gbpLocationId) return { error: "Googleマップと紐付いていない店舗です" };
  try {
    let token: string | undefined;
    if (store.gbpAuthMode === "SELF") {
      const { decryptToken } = await import("@/server/pit/gbp/token-crypto");
      const { accessTokenFor } = await import("@/server/pit/gbp/self-auth");
      const refresh = decryptToken(store.gbpRefreshTokenEnc);
      if (!refresh) return { error: "この店舗のGoogle連携が切れています（再連携が必要）" };
      token = await accessTokenFor(refresh);
    }
    const { fetchPerformanceSummary } = await import("@/server/pit/gbp/performance");
    const rows = await fetchPerformanceSummary(store.gbpLocationId, daysBack, token);
    return { ok: true, rows: rows.map((r) => ({ label: r.label, total: r.total })) };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (/403|PERMISSION_DENIED|has not been used|disabled/i.test(msg)) {
      return {
        error:
          "Business Profile Performance API が未有効の可能性があります。Cloud Console → APIとサービス → ライブラリ で有効化してください",
      };
    }
    return { error: msg };
  }
}
