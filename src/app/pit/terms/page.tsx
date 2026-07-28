import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "mbPIT 利用規約",
  robots: { index: false, follow: false },
};

const h = "mt-6 text-sm font-bold text-white";
const p = "mt-2 text-xs leading-relaxed text-neutral-300";
const li = "ml-4 list-disc text-xs leading-relaxed text-neutral-300";

// mbPIT加盟店向け利用規約（公開登録制の前提: 事後モデレーションの根拠を明文化）。
// 事業者名は「mbPIT運営事務局」としている。正式な事業者名に差し替える場合はここを編集。
export default function PitTermsPage() {
  return (
    <main className="min-h-dvh bg-[#0F1218] px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <div className="mb-6 text-center">
          <div className="text-2xl font-black tracking-tight text-white">
            mb<span className="text-[#c9a227]">PIT</span>
          </div>
          <h1 className="mt-2 text-base font-bold text-white">利用規約</h1>
        </div>

        <p className={p}>
          この利用規約（以下「本規約」）は、mbPIT運営事務局（以下「運営」）が提供する施工記録投稿サービス「mbPIT」（以下「本サービス」）の利用条件を定めるものです。加盟店登録を行った時点で、本規約に同意したものとみなします。
        </p>

        <h2 className={h}>第1条（本サービスの内容）</h2>
        <p className={p}>
          本サービスは、加盟店が投稿した施工記録（写真・メモ等）をもとにAIが記事を生成し、運営が管理するウェブサイトに施工事例として公開するサービスです。記事の生成・公開・表示方法は運営が定めます。
        </p>

        <h2 className={h}>第2条（アカウント登録）</h2>
        <ul className="mt-2 space-y-1">
          <li className={li}>登録情報（店舗名・担当者名・連絡先等）は真実かつ正確な内容を入力してください。</li>
          <li className={li}>アカウントは1店舗につき1つとし、実在する自動車関連事業者であることを前提とします。</li>
          <li className={li}>パスワードは加盟店の責任で管理してください。アカウントを通じた行為は当該加盟店の行為とみなします。</li>
        </ul>

        <h2 className={h}>第3条（投稿内容）</h2>
        <ul className="mt-2 space-y-1">
          <li className={li}>投稿は自店で実際に行った施工の記録に限ります。虚偽・誇大な内容の投稿は禁止します。</li>
          <li className={li}>写真に写り込む顧客の個人情報（ナンバープレート・氏名等）への配慮は投稿者の責任で行ってください（投稿画面のモザイク機能を利用できます）。</li>
          <li className={li}>第三者の著作権・肖像権その他の権利を侵害する内容を投稿してはいけません。</li>
          <li className={li}>法令に違反する作業（保安基準不適合となる改造、排出ガス規制の回避を目的とする作業等）の記録・宣伝は投稿できません。</li>
        </ul>

        <h2 className={h}>第4条（投稿コンテンツの取り扱い）</h2>
        <ul className="mt-2 space-y-1">
          <li className={li}>投稿された写真・文章の著作権は投稿した加盟店に帰属します。ただし加盟店は、運営が本サービスの提供・宣伝のためにこれらを無償で利用（複製・翻案・公開・記事化を含む）することを許諾するものとします。</li>
          <li className={li}>AIが生成した記事の著作権その他の権利は運営に帰属します。</li>
          <li className={li}>運営は、生成された記事を予告なく編集・非公開・削除できるものとします。</li>
        </ul>

        <h2 className={h}>第5条（禁止事項）</h2>
        <ul className="mt-2 space-y-1">
          <li className={li}>虚偽の登録・なりすまし</li>
          <li className={li}>本サービスと無関係な宣伝・スパム行為</li>
          <li className={li}>誹謗中傷・公序良俗に反する内容の投稿</li>
          <li className={li}>本サービスの運営を妨害する行為（大量登録・不正アクセス等）</li>
        </ul>

        <h2 className={h}>第6条（アカウントの停止・削除）</h2>
        <p className={p}>
          運営は、加盟店が本規約に違反した場合、またはその恐れがあると運営が判断した場合、事前の通知なくアカウントの停止・削除、および投稿・記事の非公開・削除を行うことができます。これにより加盟店に損害が生じても、運営は責任を負いません。
        </p>

        <h2 className={h}>第7条（個人情報の取り扱い）</h2>
        <p className={p}>
          運営は、登録情報および投稿に含まれる個人情報を、本サービスの提供・運営・連絡の目的にのみ利用し、法令に基づく場合を除き第三者に提供しません。
        </p>

        <h2 className={h}>第8条（免責）</h2>
        <ul className="mt-2 space-y-1">
          <li className={li}>運営は、本サービスの提供の中断・変更・終了により生じた損害について責任を負いません。</li>
          <li className={li}>AIが生成した記事の内容の正確性について、運営は保証しません。掲載前提となる施工内容の正確性は投稿した加盟店が責任を負います。</li>
          <li className={li}>加盟店と顧客・第三者との間の紛争は、当事者間で解決するものとします。</li>
        </ul>

        <h2 className={h}>第9条（規約の変更）</h2>
        <p className={p}>
          運営は、必要に応じて本規約を変更できます。変更後の規約は、本ページに掲示した時点で効力を生じます。
        </p>

        <h2 className={h}>第10条（準拠法・管轄）</h2>
        <p className={p}>
          本規約は日本法に準拠し、本サービスに関する紛争は、運営の所在地を管轄する裁判所を第一審の専属的合意管轄裁判所とします。
        </p>

        <p className="mt-6 text-[11px] text-neutral-500">制定日: 2026年7月28日</p>

        <div className="mt-8 text-center">
          <Link
            href="/pit/join"
            className="inline-block rounded-lg bg-[#c9a227] px-4 py-2 text-sm font-bold text-black"
          >
            加盟店登録へ戻る
          </Link>
        </div>
      </div>
    </main>
  );
}
