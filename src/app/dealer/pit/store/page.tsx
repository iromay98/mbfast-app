import type { Metadata } from "next";
import { pitMetadata } from "@/lib/pit-metadata";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireDealer } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { PageTitle, Card } from "@/components/ui";
import { StoreInfoEditor } from "@/components/store-info-editor";

export const dynamic = "force-dynamic";
export const metadata: Metadata = pitMetadata("mbPIT 店舗情報");

// 加盟店の店舗情報ページ（下タブ「店舗」）。HPに表示される内容を編集→即反映
export default async function PitStorePage() {
  const user = await requireDealer();
  const store = await prisma.pitStore.findUnique({
    where: { dealerId: user.dealerId },
    select: {
      id: true,
      displayName: true,
      slug: true,
      active: true,
      area: true,
      address: true,
      hours: true,
      closedDays: true,
      tel: true,
      email: true,
      website: true,
      serviceTags: true,
      intro: true,
    },
  });
  if (!store) redirect("/dealer/pit");

  return (
    <div className="space-y-4">
      <PageTitle
        title="店舗情報"
        subtitle="HPの店舗ページ・カードに表示される内容です。保存すると即時反映されます"
      />
      <Link
        href="/dealer/pit/gbp"
        className="flex items-center justify-between rounded-xl border border-line bg-white px-3 py-2.5 text-sm hover:bg-gray-50"
      >
        <span className="font-semibold text-ink">
          Googleマップ連携
          <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-800">
            準備中
          </span>
        </span>
        <span className="text-gold-600">設定 →</span>
      </Link>
      <Card>
        <StoreInfoEditor
          scope="self"
          store={{
            id: store.id,
            displayName: store.displayName,
            slug: store.slug,
            active: store.active,
            info: {
              area: store.area,
              address: store.address,
              hours: store.hours,
              closedDays: store.closedDays,
              tel: store.tel,
              email: store.email,
              website: store.website,
              serviceTags: store.serviceTags,
              intro: store.intro,
            },
            contactPerson: "",
            internalNote: "",
          }}
        />
      </Card>
    </div>
  );
}
