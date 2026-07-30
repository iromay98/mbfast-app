import type { Metadata } from "next";
import Link from "next/link";
import { requireHQ } from "@/lib/authz";
import { PageTitle, Card } from "@/components/ui";
import { gbpConfigured } from "@/server/pit/gbp/client";
import { listStoreLinks, listLinkableLocations } from "@/server/pit/gbp/link";
import { GbpLinkClient } from "./gbp-link-client";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "mbPIT Googleマップ投稿の紐付け" };

/*
 * 加盟店 ⇄ Googleビジネスプロフィールのロケーションの紐付け（本部のみ）。
 * 一覧はGoogleから取得したものをそのまま出す。**自動照合はしない**。
 * 住所を並べて出し、人が見比べて選ぶ。
 */
export default async function HqGbpPage() {
  await requireHQ();

  const cfg = gbpConfigured();
  const stores = await listStoreLinks();
  const locations = cfg.ok ? await listLinkableLocations() : null;

  return (
    <div className="space-y-3">
      <PageTitle
        title="Googleマップ投稿"
        subtitle="施工記録をお店のGoogleビジネスプロフィールへ投稿するための紐付け"
      />

      {!cfg.ok && (
        <Card className="border-amber-300">
          <p className="text-sm font-bold text-ink">Googleとの接続が未設定です</p>
          <p className="mt-1 text-xs text-ink-soft">
            未設定の環境変数: {cfg.missing.join(" / ")}
            <br />
            本番サーバーの .env に追記して再起動すると、この画面にロケーション一覧が出ます。
            接続確認はサーバー上で <span className="font-mono">npm run gbp:accounts</span> でも行えます。
          </p>
        </Card>
      )}

      {locations && !locations.ok && (
        <Card className="border-red-300">
          <p className="text-sm font-bold text-red-700">ロケーション一覧を取得できませんでした（{locations.kind}）</p>
          <div className="mt-1 space-y-0.5 break-all text-xs text-ink-soft">
            <p>HTTP {locations.httpStatus ?? "—"} / {locations.apiStatus ?? "—"}</p>
            <p>{locations.apiMessage ?? locations.message}</p>
            {(locations.details ?? []).map((d) => (
              <p key={d} className="font-mono text-[10px]">
                {d}
              </p>
            ))}
            {locations.url && <p className="font-mono text-[10px]">{locations.url}</p>}
          </div>
          <p className="mt-2 text-xs text-ink-soft">
            {locations.kind === "quota"
              ? "APIは有効ですが割り当てが足りません。上の quota_limit_value が 0 なら、そのAPIの割り当て申請がまだ通っていません（承認はAPIごと・プロジェクトごと）。"
              : locations.kind === "auth"
              ? "リフレッシュトークンが失効しています。認可をやり直して GBP_REFRESH_TOKEN を更新してください。"
              : locations.kind === "permission"
                ? "APIの有効化・スコープ（business.manage）・OAuth同意画面の設定・管理権限のいずれかをご確認ください。"
                : "時間をおいて再度お試しください。"}
          </p>
        </Card>
      )}

      <Card>
        <h3 className="text-sm font-bold text-ink">この画面でやること</h3>
        <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-xs text-ink-soft">
          <li>加盟店が自店のビジネスプロフィールに mbFAST を管理者として招待し、承諾されている</li>
          <li>
            下の一覧に出たロケーションを、<span className="font-bold text-ink">住所を見比べて</span>
            加盟店に割り当てる（自動では決めません）
          </li>
          <li>内容の確認体制ができてから「投稿を有効化」する（既定は無効）</li>
        </ol>
        <p className="mt-2 text-[11px] text-ink-soft">
          投稿は本部が内容を確認してから公開します（自動公開はしません）。
        </p>
      </Card>

      <GbpLinkClient
        stores={stores.map((s) => ({
          ...s,
          gbpLinkedAt: s.gbpLinkedAt ? s.gbpLinkedAt.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" }) : "",
        }))}
        locations={locations?.ok ? locations.locations : []}
      />

      <p className="text-[11px] text-ink-soft">
        <Link href="/hq/pit" className="hover:underline">
          ← mbPIT管理へ戻る
        </Link>
      </p>
    </div>
  );
}
