import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { storage } from "@/server/storage";
import { certHash } from "@/server/pit/vehicle";
import { CATEGORY_LABELS } from "@/server/pit/generate";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "mbPIT 施工証明書の検証",
  robots: { index: false },
};

function jstDateJa(d: Date): string {
  const j = new Date(d.getTime() + 9 * 3600 * 1000);
  return `${j.getUTCFullYear()}年${j.getUTCMonth() + 1}月${j.getUTCDate()}日`;
}

// 第三者検証ページ（ログイン不要）。URLの h（発行時ハッシュ）と、現在の記録から
// 再計算したハッシュを突き合わせ、改ざんの有無を表示する。写真そのものは表示しない。
export default async function VerifyPage({
  params,
  searchParams,
}: {
  params: Promise<{ postId: string }>;
  searchParams: Promise<{ h?: string }>;
}) {
  const { postId } = await params;
  const { h } = await searchParams;

  const post = await prisma.pitPost.findUnique({
    where: { id: postId },
    include: {
      store: { select: { displayName: true } },
      vehicleRef: { select: { chassisLast3: true } },
    },
  });
  if (!post) notFound();

  const photoKeys = Array.isArray(post.photoKeys) ? (post.photoKeys as string[]) : [];
  const photos: Buffer[] = [];
  for (const k of photoKeys) {
    const f = await storage.read(k);
    if (f) photos.push(f.buffer);
  }
  const computed = certHash({
    postId: post.id,
    vehicleName: post.vehicle,
    chassisLast3: post.vehicleRef?.chassisLast3 ?? null,
    category: post.category,
    title: post.title,
    memo: post.memo,
    storeName: post.store.displayName,
    workedAt: post.createdAt.toISOString(),
    photos,
  });
  const provided = (h ?? "").toLowerCase();
  const verified = !!provided && provided === computed;

  return (
    <div className="min-h-dvh w-full bg-[#0F1218] text-[#EDF1F7]">
      <div className="mx-auto max-w-[480px] px-4 py-6">
        <p className="text-xl font-black">
          mb<span className="text-[#E53935]">PIT</span>
          <span className="ml-2 align-middle text-[10px] font-semibold tracking-[2px] text-[#8B97A8]">
            施工証明書の検証
          </span>
        </p>

        <div
          className={`mt-4 rounded-2xl border p-5 ${
            verified ? "border-[#2E5C43] bg-[#14201A]" : "border-[#4A2A2C] bg-[#20161A]"
          }`}
        >
          <p className={`text-lg font-extrabold ${verified ? "text-[#2EBD6B]" : "text-[#FF6659]"}`}>
            {verified ? "✓ VERIFIED — 記録は改ざんされていません" : "✕ 検証NG — ハッシュが一致しません"}
          </p>
          <p className="mt-1 text-[11px] leading-relaxed text-[#8B97A8]">
            {verified
              ? "この証明書の内容（記録本文＋写真データ）は発行時から変更されていません。"
              : provided
                ? "証明書の発行後に記録が変更されたか、URLのハッシュが正しくありません。発行元にご確認ください。"
                : "URLに検証用ハッシュ（?h=…）が含まれていません。証明書ページのリンクからアクセスしてください。"}
          </p>
        </div>

        <div className="mt-4 rounded-2xl border border-[#2A3342] bg-[#181D26] p-5 text-xs">
          {[
            ["車両", post.vehicle],
            ["車台番号", `下3桁 ***${post.vehicleRef?.chassisLast3 ?? "―"}`],
            ["施工内容", post.title ?? (CATEGORY_LABELS[post.category] ?? post.category)],
            ["施工日", jstDateJa(post.createdAt)],
            ["施工店", `${post.store.displayName}（mbPIT認定店）`],
            ["発行元", "mbPIT（施工記録ポータル）"],
          ].map(([k, v]) => (
            <div key={k} className="flex border-b border-white/5 py-2 last:border-b-0">
              <span className="w-20 shrink-0 text-[#8B97A8]">{k}</span>
              <span className="font-semibold">{v}</span>
            </div>
          ))}
        </div>

        <div className="mt-3 rounded-xl border border-dashed border-[#35405A] bg-white/5 p-3">
          <p className="text-[9px] font-bold tracking-widest text-[#F2B01E]">RECORD SHA-256（現在値）</p>
          <p className="mt-1 break-all font-mono text-[9px] leading-relaxed text-[#9FB0C8]">{computed}</p>
        </div>
      </div>
    </div>
  );
}
