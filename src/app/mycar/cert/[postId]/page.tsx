import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { storage } from "@/server/storage";
import { certHash } from "@/server/pit/vehicle";
import { CATEGORY_LABELS } from "@/server/pit/generate";

export const dynamic = "force-dynamic";

function jstDateJa(d: Date): string {
  const j = new Date(d.getTime() + 9 * 3600 * 1000);
  return `${j.getUTCFullYear()}年${j.getUTCMonth() + 1}月${j.getUTCDate()}日`;
}

// 施工証明書。記録内容＋写真バイナリからSHA-256を計算し、第三者検証URLを併記する。
export default async function CertPage({ params }: { params: Promise<{ postId: string }> }) {
  const { postId } = await params;
  const key = (await cookies()).get("mycar_key")?.value;
  if (!key) redirect("/mycar");

  const post = await prisma.pitPost.findUnique({
    where: { id: postId },
    include: {
      store: { select: { displayName: true } },
      vehicleRef: { select: { vehicleKey: true, vehicleName: true, chassisLast3: true } },
    },
  });
  if (!post?.vehicleRef || post.vehicleRef.vehicleKey !== key) notFound();

  const photoKeys = Array.isArray(post.photoKeys) ? (post.photoKeys as string[]) : [];
  const photos: Buffer[] = [];
  for (const k of photoKeys) {
    const f = await storage.read(k);
    if (f) photos.push(f.buffer);
  }
  const hash = certHash({
    postId: post.id,
    vehicleName: post.vehicle,
    chassisLast3: post.vehicleRef.chassisLast3,
    category: post.category,
    title: post.title,
    memo: post.memo,
    storeName: post.store.displayName,
    workedAt: post.createdAt.toISOString(),
    photos,
  });
  const verifyPath = `/verify/${post.id}?h=${hash}`;
  const externalProof = post.externalProof as { provider?: string; tx_id?: string; url?: string } | null;

  return (
    <div className="space-y-4">
      <div className="relative overflow-hidden rounded-2xl border border-[#35405A] bg-gradient-to-br from-[#141A24] to-[#0D1118] p-5">
        <span className="pointer-events-none absolute -bottom-6 -right-3 select-none text-7xl font-black tracking-widest text-white/5">
          mbPIT
        </span>
        <p className="text-[10px] font-extrabold tracking-[3px] text-[#F2B01E]">CERTIFICATE OF WORK</p>
        <h1 className="mt-1 text-base font-extrabold">
          {CATEGORY_LABELS[post.category] ?? post.category} 施工証明書
        </h1>
        <p className="font-mono text-[10px] text-[#8B97A8]">No. MBPIT-{post.id.slice(-8).toUpperCase()}</p>

        <div className="mt-4 space-y-0 text-xs">
          {[
            ["車両", post.vehicle],
            ["車台番号", `下3桁 ***${post.vehicleRef.chassisLast3 ?? "―"}`],
            ["施工内容", post.title ?? (CATEGORY_LABELS[post.category] ?? post.category)],
            ["施工日", jstDateJa(post.createdAt)],
            ["施工店", `${post.store.displayName}（mbPIT認定店）`],
            ["発行日時", jstDateJa(new Date())],
          ].map(([k, v]) => (
            <div key={k} className="flex border-b border-white/5 py-2">
              <span className="w-20 shrink-0 text-[#8B97A8]">{k}</span>
              <span className="font-semibold">{v}</span>
            </div>
          ))}
        </div>

        {photoKeys.length > 0 && (
          <div className="mt-3 flex gap-1.5">
            {photoKeys.slice(0, 3).map((_, i) => (
              // eslint-disable-next-line @next/next/no-img-element
              <img key={i} src={`/api/mycar/photo/${post.id}/${i}`} alt="" className="h-14 w-14 rounded-lg object-cover" />
            ))}
          </div>
        )}

        <div className="mt-4 rounded-xl border border-dashed border-[#35405A] bg-white/5 p-3">
          <p className="text-[9px] font-bold tracking-widest text-[#F2B01E]">SHA-256 FINGERPRINT</p>
          <p className="mt-1 break-all font-mono text-[9px] leading-relaxed text-[#9FB0C8]">{hash}</p>
        </div>

        <div className="mt-3 rounded-xl border border-dashed border-[#35405A] bg-[rgba(61,123,217,.05)] p-3 text-[10px] leading-relaxed text-[#9FB0C8]">
          外部証明基盤との連携:{" "}
          {externalProof?.provider ? (
            <>
              {externalProof.provider}（{externalProof.tx_id ?? "-"}）
            </>
          ) : (
            "未連携（将来のブロックチェーン刻印等に対応する連携スロットを備えています）"
          )}
        </div>
      </div>

      <a
        href={verifyPath}
        className="block w-full rounded-xl border border-[#2A3342] py-3 text-center text-xs font-bold text-[#EDF1F7]"
      >
        🔍 第三者検証ページを開く（買取店・保険会社向け）
      </a>
      <p className="px-1 text-[10px] leading-relaxed text-[#8B97A8]">
        検証ページのURLを相手に送ると、記録が改ざんされていないことをログイン不要で確認できます。
      </p>
      <Link href="/mycar/history" className="block text-center text-[11px] text-[#8B97A8] underline">
        ← 履歴に戻る
      </Link>
    </div>
  );
}
