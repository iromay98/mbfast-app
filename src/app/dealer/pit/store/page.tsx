import type { Metadata } from "next";
import { pitMetadata } from "@/lib/pit-metadata";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireDealer } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { PageTitle, Card } from "@/components/ui";
import { STORE_META_SELECT, pickStoreInfo } from "@/server/pit/store-meta";
import { StoreInfoEditor } from "@/components/store-info-editor";
import { CertSettingsEditor } from "@/components/cert-settings-editor";

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
      ...STORE_META_SELECT,
      // 証明書の体裁・記載範囲／AI記事の公開前確認（自店のみ編集可）
      facilityType: true,
      certBrandName: true,
      certShowCustomerName: true,
      certShowCustomerAddress: true,
      certShowCustomerTel: true,
      certShowAmount: true,
      postReviewRequired: true,
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
            info: pickStoreInfo(store),
            contactPerson: "",
            internalNote: "",
          }}
        />
      </Card>

      {/* 証明書の体裁・記載範囲とAI記事の公開前確認（WordPressへは同期しないアプリ内設定） */}
      <Card>
        <p className="mb-2 text-base font-bold text-ink">施工証明書・投稿の設定</p>
        <CertSettingsEditor
          storeName={store.displayName}
          legalFacility={store.facilityType !== "general"}
          initial={{
            certBrandName: store.certBrandName,
            certShowCustomerName: store.certShowCustomerName,
            certShowCustomerAddress: store.certShowCustomerAddress,
            certShowCustomerTel: store.certShowCustomerTel,
            certShowAmount: store.certShowAmount,
            postReviewRequired: store.postReviewRequired,
          }}
        />
      </Card>
    </div>
  );
}
