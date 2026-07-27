import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { CATEGORY_LABELS } from "@/server/pit/generate";

export const dynamic = "force-dynamic";

function jstDate(d: Date): string {
  const j = new Date(d.getTime() + 9 * 3600 * 1000);
  return `${j.getUTCFullYear()}.${String(j.getUTCMonth() + 1).padStart(2, "0")}.${String(j.getUTCDate()).padStart(2, "0")}`;
}

// 施工履歴タイムライン（お薬手帳）。cookieの vehicleKey に紐づく記録だけを表示する。
export default async function MycarHistory() {
  const key = (await cookies()).get("mycar_key")?.value;
  if (!key) redirect("/mycar");

  const vehicle = await prisma.pitVehicle.findUnique({
    where: { vehicleKey: key },
    include: {
      posts: {
        where: { status: { in: ["published", "held"] } },
        orderBy: { createdAt: "desc" },
        include: { store: { select: { displayName: true } } },
      },
    },
  });
  if (!vehicle) redirect("/mycar");

  // 車検期限と残日数
  const expiry = vehicle.inspectionExpiry;
  const daysLeft = expiry ? Math.ceil((expiry.getTime() - Date.now()) / 86400000) : null;

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[#2A3342] bg-[#181D26] p-5">
        <p className="text-base font-extrabold">🚗 {vehicle.vehicleName ?? "マイカー"}</p>
        <p className="mt-1 text-[11px] text-[#8B97A8]">
          {vehicle.modelCode ? `型式 ${vehicle.modelCode}・` : ""}
          車台番号 下3桁 ***{vehicle.chassisLast3 ?? "―"}・記録 {vehicle.posts.length} 件
        </p>
        {expiry && daysLeft !== null && (
          <div
            className={`mt-3 rounded-xl border p-3 text-xs leading-relaxed ${
              daysLeft <= 60
                ? "border-[#4A2A2C] bg-[#20161A] text-[#FF6659]"
                : "border-[#2A3342] bg-[#1F2632] text-[#EDF1F7]"
            }`}
          >
            🔔 車検満了: {jstDate(expiry)}（残り{daysLeft}日）
            {daysLeft <= 60 && " — お早めに施工店へご相談ください"}
          </div>
        )}
      </div>

      <div className="rounded-2xl border border-[#2A3342] bg-[#181D26] p-5">
        <p className="mb-2 text-xs font-extrabold tracking-wider text-[#8B97A8]">施工履歴</p>
        {vehicle.posts.length === 0 ? (
          <p className="text-xs text-[#8B97A8]">まだ記録がありません。</p>
        ) : (
          <div className="relative pl-4">
            <div className="absolute bottom-2 left-1 top-2 w-0.5 bg-[#2A3342]" />
            {vehicle.posts.map((p) => {
              const photoCount = Array.isArray(p.photoKeys) ? (p.photoKeys as string[]).length : 0;
              return (
                <div key={p.id} className="relative py-3">
                  <span className="absolute -left-[13px] top-5 h-2 w-2 rounded-full bg-[#E53935] ring-2 ring-[#181D26]" />
                  <p className="text-[10px] text-[#8B97A8]">
                    {jstDate(p.createdAt)}・{p.store.displayName}
                  </p>
                  <p className="mt-0.5 text-sm font-bold">
                    {p.title ?? `${p.vehicle} の${CATEGORY_LABELS[p.category] ?? p.category}`}
                  </p>
                  {photoCount > 0 && (
                    <div className="mt-2 flex gap-1.5 overflow-x-auto">
                      {Array.from({ length: Math.min(photoCount, 4) }, (_, i) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          key={i}
                          src={`/api/mycar/photo/${p.id}/${i}`}
                          alt=""
                          className="h-16 w-16 rounded-lg object-cover"
                        />
                      ))}
                    </div>
                  )}
                  <div className="mt-2 flex flex-wrap gap-2 text-[10px]">
                    <span className="rounded-full bg-[rgba(61,123,217,.15)] px-2 py-0.5 font-bold text-[#7FA8E8]">
                      {CATEGORY_LABELS[p.category] ?? p.category}
                    </span>
                    {p.status === "published" && p.publishedUrl && (
                      <a
                        href={p.publishedUrl}
                        target="_blank"
                        rel="noopener"
                        className="rounded-full bg-[rgba(46,189,107,.14)] px-2 py-0.5 font-bold text-[#2EBD6B]"
                      >
                        📝 記事を見る
                      </a>
                    )}
                    <Link
                      href={`/mycar/cert/${p.id}`}
                      className="rounded-full bg-[rgba(242,176,30,.14)] px-2 py-0.5 font-bold text-[#F2B01E]"
                    >
                      🛡 施工証明書
                    </Link>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <p className="px-1 text-[10px] leading-relaxed text-[#8B97A8]">
        証明書付きの記録は、売却時に「整備の証拠」として買取店へ提示できます。この端末には車両キーのみ保存されており、車台番号そのものは保存されていません。
      </p>
      <Link href="/mycar" className="block text-center text-[11px] text-[#8B97A8] underline">
        別の車両を見る
      </Link>
    </div>
  );
}
