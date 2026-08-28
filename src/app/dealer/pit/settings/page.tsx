import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireDealer } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { PageTitle } from "@/components/ui";
import { pitMetadata } from "@/lib/pit-metadata";

export const metadata: Metadata = pitMetadata("設定");

/*
 * 設定メニュー（下タブ「設定」の入口）。
 *
 * 店舗情報・Googleマップ連携など「たまに触る管理系」をここに集約する。
 * タブを増やさずに項目を増やせる置き場でもある（今後: パスワード変更・通知設定など）。
 * 各項目に現在の状態を添える＝開かなくても健全性が分かる。
 */
export default async function PitSettingsPage() {
  const user = await requireDealer();
  const store = await prisma.pitStore.findUnique({
    where: { dealerId: user.dealerId },
    select: {
      active: true,
      displayName: true,
      intro: true,
      mapUrl: true,
      writingTone: true,
      gbpLocationId: true,
      gbpPostingEnabled: true,
    },
  });
  if (!store?.active) redirect("/dealer/pit");

  const gbpOn = Boolean(store.gbpPostingEnabled && store.gbpLocationId);
  const toneLabel =
    { polite: "ていねい", casual: "親しみやすい", formal: "論説調" }[store.writingTone] ??
    "ていねい";

  const items: { href: string; title: string; desc: string; state?: { text: string; ok: boolean } }[] = [
    {
      href: "/dealer/pit/store",
      title: "店舗情報",
      desc: "紹介文・営業時間・連絡先・地図。HPの店舗ページに反映されます",
      state: store.intro
        ? { text: "設定済み", ok: true }
        : { text: "紹介文が未入力", ok: false },
    },
    {
      href: "/dealer/pit/gbp",
      title: "Googleマップ連携",
      desc: "施工の投稿をお店のGoogleマップにも自動掲載します",
      state: gbpOn ? { text: "有効", ok: true } : { text: "未連携", ok: false },
    },
    {
      href: "/dealer/pit/store#tone",
      title: "文体の設定",
      desc: "記事とマップ投稿の語り口（店舗情報ページ内）",
      state: { text: toneLabel, ok: true },
    },
  ];

  return (
    <div className="space-y-4">
      <PageTitle title="設定" subtitle={store.displayName} />
      <ul className="space-y-2">
        {items.map((it) => (
          <li key={it.href}>
            <Link
              href={it.href}
              className="flex items-center justify-between gap-3 rounded-xl border border-line bg-surface px-3 py-3 hover:bg-surface-2"
            >
              <span className="min-w-0">
                <span className="block text-sm font-bold text-ink">{it.title}</span>
                <span className="block text-xs text-ink-soft">{it.desc}</span>
              </span>
              <span className="flex shrink-0 items-center gap-2">
                {it.state && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                      it.state.ok
                        ? "bg-emerald-100 text-emerald-800"
                        : "bg-amber-100 text-amber-800"
                    }`}
                  >
                    {it.state.text}
                  </span>
                )}
                <span className="text-ink-soft">→</span>
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
