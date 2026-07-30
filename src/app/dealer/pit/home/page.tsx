import type { Metadata } from "next";
import { pitMetadata } from "@/lib/pit-metadata";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireDealer } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { formatDate, formatDateTime } from "@/lib/labels";
import { PageTitle, Card } from "@/components/ui";
import { storeStats } from "@/server/pit/gamification";
import { listUpcomingInspections } from "@/server/pit/customer-repo";
import { countUnissuedDrafts } from "@/server/pit/certificate";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pitMetadata("mbPIT 加盟店ポータル");

// 加盟店ホーム: 実績サマリー＋車検が近いお客様（声かけ営業のきっかけ）＋最近の投稿
export default async function PitHomePage() {
  const user = await requireDealer();
  const store = await prisma.pitStore.findUnique({
    where: { dealerId: user.dealerId },
    select: { id: true, displayName: true, active: true },
  });
  if (!store) redirect("/dealer/pit"); // 未登録店舗は投稿ページ側の案内へ

  const now = new Date();
  const [stats, upcoming, recentPosts, unissuedCerts] = await Promise.all([
    storeStats(store.id),
    // 顧客の参照は customer-repo 経由（storeId条件の付け忘れを構造的に防ぐ）
    listUpcomingInspections(store.id, 60),
    prisma.pitPost.findMany({
      // スタンバイ下書き（施工証明由来・未投稿）は「最近の投稿」には出さない
      where: { storeId: store.id, status: { not: "draft" } },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, vehicle: true, status: true, title: true, publishedUrl: true, createdAt: true },
    }),
    // 作ったのに渡していない証明書を放置させない（未発行の下書き・発行失敗）
    countUnissuedDrafts(store.id),
  ]);

  const daysLeft = (d: Date) => Math.ceil((d.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));

  return (
    <div className="space-y-4">
      <PageTitle title="ホーム" subtitle={store.displayName} />

      {/* 実績＋記録ボタン（HPと同じ黒×ゴールド）。
          実績は数字とラベルを横並びの1行にまとめて縦を詰め、「記録する」を最短距離に置く。 */}
      <div className="rounded-2xl border border-[#c9a227]/30 bg-[#0d0d0d] p-3 text-white">
        <div className="flex items-center justify-center gap-3 text-[11px] text-white/60">
          <span>
            <b className="mr-1 text-base font-black text-[#e7d18d]">{stats.total}</b>通算
          </span>
          <span className="text-white/25">|</span>
          <span>
            <b className="mr-1 text-base font-black text-white">{stats.month}</b>今月
          </span>
          <span className="text-white/25">|</span>
          <span>
            {stats.streakWeeks > 0 ? (
              <>
                <b className="mr-1 text-base font-black text-orange-300">🔥{stats.streakWeeks}</b>週連続
              </>
            ) : (
              "今週まだ0件"
            )}
          </span>
          {stats.badge && (
            <span className="whitespace-nowrap font-bold text-[#e7d18d]">
              {stats.badge.emoji}
              {stats.badge.name}
            </span>
          )}
        </div>
        <Link
          href="/dealer/pit"
          className="mt-2.5 block rounded-xl bg-[#c9a227] py-3 text-center text-base font-extrabold text-[#0d0d0d]"
        >
          🎤 今日の施工を記録する
        </Link>
        <p className="mt-1.5 text-center text-[10px] text-white/50">
          写真を選んで話すだけ・約1分でブログ記事になります
        </p>
      </div>

      {/* 未発行の証明書（お客様にまだ渡せていない状態を知らせる） */}
      {unissuedCerts > 0 && (
        <Link
          href="/dealer/pit/certificates"
          className="block rounded-xl border border-amber-300 bg-amber-50 px-3 py-2.5 text-sm font-bold text-amber-900"
        >
          未発行の施工証明書が{unissuedCerts}件あります
          <span className="mt-0.5 block text-[11px] font-normal">
            発行するとお客様に渡せるURLとPDFができます →
          </span>
        </Link>
      )}

      {/* 車検が近いお客様 */}
      <Card>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-bold text-ink">🚗 車検が近いお客様</h3>
          <Link href="/dealer/pit/customers" className="text-sm text-gold-600 hover:underline">
            顧客カルテ →
          </Link>
        </div>
        {upcoming.length === 0 ? (
          <p className="text-xs text-ink-soft">
            60日以内に車検を迎えるお客様はいません。顧客カルテに車検満了日を入れておくと、ここでお知らせします。
          </p>
        ) : (
          <div className="divide-y divide-line">
            {upcoming.map((c) => {
              const left = daysLeft(c.inspectionExpiry!);
              return (
                <div key={c.id} className="flex items-center gap-2 py-2 text-sm">
                  <div className="min-w-0">
                    <div className="truncate font-semibold">{c.name} 様</div>
                    {c.vehicleName && (
                      <div className="truncate text-xs text-ink-soft">{c.vehicleName}</div>
                    )}
                  </div>
                  <span
                    className={`ml-auto shrink-0 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-bold ${
                      left <= 30 ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {left < 0 ? "車検切れ" : `あと${left}日`}
                    <span className="ml-1 font-normal">{formatDate(c.inspectionExpiry!)}</span>
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* 最近の投稿 */}
      <Card>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-bold text-ink">最近の投稿</h3>
          <Link href="/dealer/pit" className="text-sm text-gold-600 hover:underline">
            投稿する →
          </Link>
        </div>
        {recentPosts.length === 0 ? (
          <p className="text-xs text-ink-soft">まだ投稿がありません。最初の施工を記録してみましょう。</p>
        ) : (
          <div className="divide-y divide-line">
            {recentPosts.map((p) => (
              <div key={p.id} className="flex flex-wrap items-center gap-2 py-2 text-xs">
                <span className="text-ink-soft">{formatDateTime(p.createdAt)}</span>
                <span className="font-semibold">{p.vehicle}</span>
                {p.publishedUrl ? (
                  <a
                    href={p.publishedUrl}
                    target="_blank"
                    rel="noopener"
                    className="max-w-[14rem] truncate text-sky-700 hover:underline"
                  >
                    {p.title ?? "記事を見る"}
                  </a>
                ) : (
                  <span className="text-ink-soft">{p.status === "held" ? "確認中" : p.status}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
