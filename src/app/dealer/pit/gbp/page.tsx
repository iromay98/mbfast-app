import type { Metadata } from "next";
import { pitMetadata } from "@/lib/pit-metadata";
import { redirect } from "next/navigation";
import { requireDealer } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { PageTitle, Card } from "@/components/ui";
import { gbpManagerEmail } from "@/server/pit/gbp/client";
import { manualTargetFor } from "@/server/pit/gbp/link";
import { selfAuthConfigured } from "@/server/pit/gbp/self-auth";
import { GbpSelfClient } from "./gbp-self-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pitMetadata("mbPIT Googleマップ連携");

/*
 * 加盟店向け「Googleマップ連携」ページ。
 *
 * 投稿APIは承認済みで、本店では実稼働している（2026-08-28 初投稿）。
 * このページは (1) 自店の連携状態、(2) 連携すると何が起きるか、
 * (3) 連携の手段＝方式B（自分でGoogleログイン）か方式A（運営を管理者に招待）
 * を案内する。
 *
 * 方式B（既定）: 加盟店が自分のGoogleアカウントでログインし、自店の拠点を自分で選ぶ。
 * 店主本人のトークンで一覧を取るので、他店の拠点は候補にすら出ない＝誤紐付けが起きない。
 *
 * 方式A（代替）: 加盟店が運営を管理者に招待し、運営が住所を見比べて紐付ける。
 * オーナー権限が無い店・Googleログインに抵抗がある店のために残してある。
 */
export default async function PitGbpPage() {
  const user = await requireDealer();
  const store = await prisma.pitStore.findUnique({
    where: { dealerId: user.dealerId },
    select: {
      id: true,
      slug: true,
      displayName: true,
      active: true,
      gbpLocationId: true,
      gbpLocationName: true,
      gbpLocationAddr: true,
      gbpPostingEnabled: true,
      gbpAuthMode: true,
      gbpRefreshTokenEnc: true,
      gbpAuthEmail: true,
      gbpAuthRevokedAt: true,
    },
  });
  if (!store) redirect("/dealer/pit");

  const selfCfg = selfAuthConfigured();
  const managerEmail = gbpManagerEmail();
  // 運営側で投稿先が決まっているか（DBの紐付け or 手動指定）。加盟店には可否だけ見せる。
  const linked = Boolean(store.gbpLocationId) || Boolean(manualTargetFor(store));
  // 審査中は投稿を有効化しない設計なので、これが true になるのは承認後だけ。
  const live = store.active && store.gbpPostingEnabled && linked;

  return (
    <div className="space-y-4">
      <PageTitle
        title="Googleマップ連携"
        subtitle="施工の投稿をお店のGoogleマップ（ビジネスプロフィール）にも載せる機能です"
      />

      {/* 現在の状態 */}
      {live ? (
        <div className="rounded-2xl border border-emerald-300 bg-emerald-50 p-4">
          <div className="text-sm font-bold text-emerald-900">✅ 連携済み・投稿が有効です</div>
          <p className="mt-1 text-xs text-emerald-800">
            新しい施工の投稿が、お店のGoogleマップのプロフィールにも掲載されます。
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4">
          <div className="flex items-center gap-2 text-sm font-bold text-amber-900">
            <span className="inline-block rounded-full bg-amber-200 px-2 py-0.5 text-[11px]">
              未連携
            </span>
            Googleマップへの自動投稿はまだ始まっていません
          </div>
          <p className="mt-1.5 text-xs leading-relaxed text-amber-800">
            下の手順でお店のGoogleアカウントを連携すると、施工の投稿がお店のGoogleマップにも
            自動で掲載されるようになります。連携後、運営が確認して投稿を有効にします。
          </p>
        </div>
      )}

      {/* 何ができるようになるか */}
      <Card>
        <h3 className="text-sm font-bold text-ink">この機能でできること</h3>
        <ul className="mt-2 space-y-1.5 text-xs leading-relaxed text-ink-soft">
          <li>・投稿した施工記録の写真とコメントを、お店のGoogleマップにも掲載します</li>
          <li>・お客様がGoogleマップでお店を見たときに、施工事例が並びます</li>
          <li>・投稿の作成はいつもどおり。連携すると自動でGoogleマップにも反映されます</li>
        </ul>
        <p className="mt-2 rounded-lg bg-gray-50 px-3 py-2 text-[11px] leading-relaxed text-ink-soft">
          お客様の氏名・住所・連絡先・車台番号・金額など、非公開の情報がGoogleマップに載ることはありません。
          Googleマップに載るのは、公開ブログに掲載したものと同じ写真とコメントだけです。
        </p>
      </Card>

      {/* 方式B: 自分で連携する（既定の導線） */}
      {selfCfg.ok && (
        <GbpSelfClient
          connected={Boolean(store.gbpRefreshTokenEnc)}
          authEmail={store.gbpAuthEmail}
          selectedLocationId={store.gbpLocationId}
          selectedName={store.gbpLocationName}
          selectedAddr={store.gbpLocationAddr}
          revoked={Boolean(store.gbpAuthRevokedAt)}
        />
      )}

      {/* 方式A: 自分で連携できない場合の代替。既定では畳んでおく */}
      <details className="rounded-2xl border border-line bg-white p-4">
        <summary className="cursor-pointer text-sm font-bold text-ink">
          うまく連携できない場合（運営を管理者に招待する方法）
        </summary>
        <p className="mt-2 text-xs leading-relaxed text-ink-soft">
          お店のGoogleアカウントのオーナー権限をお持ちでない場合や、上の連携がうまくいかない場合は、
          運営を管理者として招待していただければ、運営側で設定します。
        </p>
        <h3 className="mt-3 text-sm font-bold text-ink">mbPIT運営を「管理者」に招待する</h3>
        <p className="mt-1 text-xs leading-relaxed text-ink-soft">
          お店のGoogleビジネスプロフィールに、mbPIT運営のGoogleアカウントを
          <b>「管理者」</b>として招待してください。招待いただくと、承認後に運営側から投稿できるようになります。
        </p>

        <div className="mt-3 rounded-lg border border-line bg-white p-3">
          <div className="text-[11px] text-ink-soft">招待するGoogleアカウント</div>
          {managerEmail ? (
            <div className="mt-0.5 font-mono text-sm font-bold text-ink">{managerEmail}</div>
          ) : (
            <div className="mt-0.5 text-sm font-bold text-ink">
              本部よりご案内します（お問い合わせください）
            </div>
          )}
        </div>

        <ol className="mt-3 space-y-2 text-xs leading-relaxed text-ink-soft">
          <li>
            <b>1.</b> パソコンまたはスマホで{" "}
            <a
              href="https://business.google.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="text-gold-600 underline"
            >
              Googleビジネスプロフィール
            </a>
            にログインし、お店を選びます。
          </li>
          <li>
            <b>2.</b> 「ビジネスプロフィールの設定」→「ユーザーとアクセス」（または「ユーザー」）を開きます。
          </li>
          <li>
            <b>3.</b> 「追加」または「ユーザーを追加」から、上のアカウントを入力します。
          </li>
          <li>
            <b>4.</b> 権限（役割）で <b>「管理者」</b> を選び、招待を送信します。
            （「オーナー」ではなく「管理者」で構いません）
          </li>
          <li>
            <b>5.</b> 招待が完了したら、この画面はそのままで大丈夫です。承認が下り次第、運営側で有効化します。
          </li>
        </ol>

        <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-[11px] leading-relaxed text-ink-soft">
          管理者の招待は、お店側でいつでも取り消せます。連携をやめたいときは、同じ画面から
          mbPIT運営のアカウントを削除してください。
        </p>
      </details>

      {/* 連携状況（運営側の紐付け状態を可否だけ表示） */}
      <Card>
        <h3 className="text-sm font-bold text-ink">連携状況</h3>
        <dl className="mt-2 space-y-1.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <dt className="text-ink-soft">Googleマップとの紐付け</dt>
            <dd className="font-bold">
              {linked ? (
                <span className="text-emerald-700">紐付け済み</span>
              ) : (
                <span className="text-ink-soft">未紐付け（招待をお待ちしています）</span>
              )}
            </dd>
          </div>
          <div className="flex items-center justify-between gap-2">
            <dt className="text-ink-soft">自動投稿</dt>
            <dd className="font-bold">
              {live ? (
                <span className="text-emerald-700">有効</span>
              ) : (
                <span className="text-amber-700">準備中</span>
              )}
            </dd>
          </div>
        </dl>
        <p className="mt-2 text-[11px] leading-relaxed text-ink-soft">
          投稿先の紐付けと公開の可否は、取り違えを防ぐため運営側で1件ずつ確認します。
          店名だけで自動的に紐付けることはしません。
        </p>
      </Card>
    </div>
  );
}
