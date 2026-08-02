import type { Metadata } from "next";
import { PIT_APP_ICONS } from "@/lib/pit-metadata";
import { JoinForm } from "./join-form";

export const metadata: Metadata = {
  title: "mbPIT 加盟店登録",
  robots: { index: false, follow: false }, // mbPITセクションが限定公開の間はnoindex（STEALTH解除時に見直し）
  // 加盟店候補が最初に見る公開ページ。ホーム画面に追加してもmbFASTのアイコンにしない
  ...PIT_APP_ICONS,
  appleWebApp: { capable: true, title: "mbPIT", statusBarStyle: "default" },
};

// mbPIT加盟店の自己登録ページ（公開・ログイン不要）。
// 誰でも登録でき、その場で投稿を始められる。不適切な店舗は本部が事後に停止する（マチアプ方式）。
// mbPITは独立ブランドのため、ポータルの mbFAST 表記は出さない（黒×ゴールド）。
export default function PitJoinPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#0F1218] px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="text-2xl font-black tracking-tight text-white">
            mb<span className="text-[#c9a227]">PIT</span>
          </div>
          <p className="mt-1 text-sm text-neutral-400">加盟店の施工記録ポータル</p>
        </div>
        <JoinForm />
      </div>
    </main>
  );
}
