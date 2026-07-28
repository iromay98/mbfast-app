import type { Metadata } from "next";
import { prisma } from "@/lib/db";
import { JoinForm } from "./join-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "mbPIT 加盟店登録",
  robots: { index: false, follow: false }, // 招待制ページ。検索に載せない
};

// mbPIT加盟店の自己登録ページ（招待リンク限定・ログイン不要）。
// mbPITは独立ブランドのため、ポータルの mbFAST 表記は出さない（黒×ゴールド）。
export default async function PitJoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invite = await prisma.pitInvite.findUnique({
    where: { token },
    select: { usedAt: true },
  });
  const valid = !!invite && !invite.usedAt;

  return (
    <main className="flex min-h-dvh items-center justify-center bg-[#0F1218] px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="text-2xl font-black tracking-tight text-white">
            mb<span className="text-[#c9a227]">PIT</span>
          </div>
          <p className="mt-1 text-sm text-neutral-400">加盟店の施工記録ポータル</p>
        </div>
        {valid ? (
          <JoinForm token={token} />
        ) : (
          <div className="rounded-xl border border-neutral-700 bg-neutral-900 p-5 text-center">
            <p className="text-sm text-neutral-200">この招待リンクは無効です。</p>
            <p className="mt-2 text-xs text-neutral-400">
              使用済みか取消済みの可能性があります。お手数ですが本部までお問い合わせください。
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
