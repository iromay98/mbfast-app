import { requireHQ } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { Badge, Button, Card, EmptyState, PageTitle } from "@/components/ui";
import { PIT_CATEGORY_LABELS, PIT_STATUS_LABELS } from "@/lib/pit-labels";
import { INITIAL_PIT_STORES } from "@/server/pit/presets";
import { publishHeldPitPost, retryPitPost } from "@/lib/actions/pit";
import { PitStoreForm } from "./store-form";

export const dynamic = "force-dynamic";

// mbPIT 運用・監視（本部）。店舗マスタ管理・保留投稿の確認・公開ログ・月次集計。
export default async function HqPitPage() {
  await requireHQ();

  const [stores, dealers, held, failed, recentPosts] = await Promise.all([
    prisma.pitStore.findMany({
      include: { dealer: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    prisma.dealer.findMany({
      where: { status: "ACTIVE", pitStore: null },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.pitPost.findMany({
      where: { status: "HELD" },
      include: { store: { select: { displayName: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.pitPost.findMany({
      where: { status: "FAILED" },
      include: { store: { select: { displayName: true } } },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.pitPost.findMany({
      include: { store: { select: { displayName: true } } },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
  ]);

  // 月次 店舗別記事数（公開済み・直近6ヶ月、JST基準）
  const since = new Date();
  since.setMonth(since.getMonth() - 5);
  since.setDate(1);
  since.setHours(0, 0, 0, 0);
  const publishedRecent = await prisma.pitPost.findMany({
    where: { status: "PUBLISHED", publishedAt: { gte: since } },
    select: { storeId: true, publishedAt: true },
  });
  const monthKey = (d: Date) =>
    new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit" })
      .format(d)
      .replace("/", "-");
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - (5 - i));
    return monthKey(d);
  });
  const counts = new Map<string, number>(); // `${storeId}|${month}` → count
  for (const p of publishedRecent) {
    if (!p.publishedAt) continue;
    const key = `${p.storeId}|${monthKey(p.publishedAt)}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  const statusColor = (s: string) =>
    s === "PUBLISHED" ? "green" : s === "PROCESSING" ? "blue" : s === "HELD" ? "amber" : "red";
  const fmt = (d: Date) => new Date(d).toLocaleString("ja-JP", { timeZone: "Asia/Tokyo" });

  return (
    <div className="space-y-6">
      <PageTitle
        title="施工ブログ（mbPIT）"
        subtitle="店舗投稿 → AI記事化 → mbfasttuning.com 自動公開の運用・監視"
      />

      {/* ── 保留投稿（要確認） ───────────────────── */}
      {held.length > 0 && (
        <Card className="border-amber-300">
          <h2 className="mb-3 text-sm font-bold text-ink">
            ⚠️ 保留中の投稿（コンテンツガード該当・自動公開していません）
          </h2>
          <ul className="space-y-3">
            {held.map((p) => (
              <li key={p.id} className="rounded-lg border border-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <p className="text-sm font-semibold text-ink">
                      {p.store.displayName} / {p.vehicle}（{PIT_CATEGORY_LABELS[p.category]}）
                    </p>
                    <p className="mt-1 text-xs text-red-700">{p.holdReason}</p>
                    {p.memo && <p className="mt-1 text-xs text-ink-soft">メモ: {p.memo}</p>}
                    <p className="mt-1 text-xs text-ink-soft">{fmt(p.createdAt)}</p>
                  </div>
                  <form action={publishHeldPitPost.bind(null, p.id)}>
                    <Button type="submit" variant="secondary">
                      確認済みとして公開する
                    </Button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ── 失敗投稿（再試行） ───────────────────── */}
      {failed.length > 0 && (
        <Card className="border-red-300">
          <h2 className="mb-3 text-sm font-bold text-ink">エラーになった投稿</h2>
          <ul className="space-y-3">
            {failed.map((p) => (
              <li key={p.id} className="rounded-lg border border-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-ink">
                      {p.store.displayName} / {p.vehicle}（{PIT_CATEGORY_LABELS[p.category]}）
                    </p>
                    <p className="mt-1 break-all text-xs text-red-700">{p.error}</p>
                    <p className="mt-1 text-xs text-ink-soft">{fmt(p.createdAt)}</p>
                  </div>
                  <form action={retryPitPost.bind(null, p.id)}>
                    <Button type="submit" variant="secondary">
                      再試行
                    </Button>
                  </form>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* ── 月次 店舗別記事数 ────────────────────── */}
      <Card>
        <h2 className="mb-3 text-sm font-bold text-ink">月次 店舗別公開記事数（直近6ヶ月）</h2>
        {stores.length === 0 ? (
          <p className="text-sm text-ink-soft">店舗が未登録です。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-soft">
                  <th className="py-2 pr-3">店舗</th>
                  {months.map((m) => (
                    <th key={m} className="px-2 py-2 text-right">
                      {m}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {stores.map((s) => (
                  <tr key={s.id} className="border-b border-line/60">
                    <td className="py-2 pr-3 font-medium text-ink">{s.displayName}</td>
                    {months.map((m) => (
                      <td key={m} className="px-2 py-2 text-right text-ink">
                        {counts.get(`${s.id}|${m}`) ?? 0}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ── 店舗マスタ ───────────────────────────── */}
      <Card>
        <h2 className="mb-1 text-sm font-bold text-ink">店舗マスタ</h2>
        <p className="mb-3 text-xs text-ink-soft">
          親カテゴリ: mbPIT施工記録（ID 545, slug: mbpit）。既存の「代理店」カテゴリ（本部管理ブログ）はこの機能からは使用しません。
        </p>
        <div className="space-y-4">
          {stores.map((s) => (
            <details key={s.id} className="rounded-lg border border-line p-3">
              <summary className="cursor-pointer text-sm font-semibold text-ink">
                {s.displayName}
                <span className="ml-2 text-xs font-normal text-ink-soft">
                  アカウント: {s.dealer.name} / カテゴリID {s.wpCategoryId} / {s.storeSlug}
                </span>
                {!s.active && (
                  <span className="ml-2">
                    <Badge color="gray">無効</Badge>
                  </span>
                )}
                {!s.footerHtml && (
                  <span className="ml-2">
                    <Badge color="amber">フッター未投入</Badge>
                  </span>
                )}
              </summary>
              <div className="mt-3">
                <PitStoreForm
                  dealers={[]}
                  defaults={{
                    dealerId: s.dealerId,
                    displayName: s.displayName,
                    wpCategoryId: s.wpCategoryId,
                    storeSlug: s.storeSlug,
                    footerHtml: s.footerHtml,
                    active: s.active,
                  }}
                  submitLabel="更新"
                />
              </div>
            </details>
          ))}

          <details className="rounded-lg border border-dashed border-line p-3">
            <summary className="cursor-pointer text-sm font-semibold text-ink">＋ 店舗を追加</summary>
            <div className="mt-3">
              {dealers.length === 0 ? (
                <p className="text-sm text-ink-soft">追加できる代理店アカウントがありません。</p>
              ) : (
                <PitStoreForm dealers={dealers} presets={INITIAL_PIT_STORES} submitLabel="登録" />
              )}
            </div>
          </details>
        </div>
      </Card>

      {/* ── 公開ログ ─────────────────────────────── */}
      <Card>
        <h2 className="mb-3 text-sm font-bold text-ink">投稿ログ（最新50件）</h2>
        {recentPosts.length === 0 ? (
          <EmptyState message="まだ投稿がありません。" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-ink-soft">
                  <th className="py-2 pr-3">日時</th>
                  <th className="py-2 pr-3">店舗</th>
                  <th className="py-2 pr-3">車種 / 施工</th>
                  <th className="py-2 pr-3">状態</th>
                  <th className="py-2 pr-3">ガード</th>
                  <th className="py-2">URL</th>
                </tr>
              </thead>
              <tbody>
                {recentPosts.map((p) => {
                  const guard = p.guardResult as {
                    blocked?: string[];
                    caution?: string[];
                    piiRemoved?: boolean;
                  } | null;
                  const guardNote = [
                    guard?.blocked?.length ? `ブロック: ${guard.blocked.join(",")}` : null,
                    guard?.caution?.length ? `注意書き` : null,
                    guard?.piiRemoved ? "PII除去" : null,
                  ]
                    .filter(Boolean)
                    .join(" / ");
                  return (
                    <tr key={p.id} className="border-b border-line/60 align-top">
                      <td className="whitespace-nowrap py-2 pr-3 text-xs text-ink-soft">
                        {fmt(p.createdAt)}
                      </td>
                      <td className="py-2 pr-3">{p.store.displayName}</td>
                      <td className="py-2 pr-3">
                        {p.vehicle}
                        <span className="text-xs text-ink-soft">
                          （{PIT_CATEGORY_LABELS[p.category]}）
                        </span>
                      </td>
                      <td className="py-2 pr-3">
                        <Badge color={statusColor(p.status)}>{PIT_STATUS_LABELS[p.status]}</Badge>
                      </td>
                      <td className="py-2 pr-3 text-xs text-ink-soft">{guardNote || "—"}</td>
                      <td className="py-2">
                        {p.publishedUrl ? (
                          <a
                            href={p.publishedUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-gold-600 underline"
                          >
                            記事
                          </a>
                        ) : (
                          <span className="text-xs text-ink-soft">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
