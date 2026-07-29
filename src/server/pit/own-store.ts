/*
 * 「ログイン中の代理店＝どのmbPIT店舗か」の唯一の解決経路。
 * クライアントから渡された storeId は信用しない（顧客情報は店舗間で見えてはならない）。
 */
import { prisma } from "@/lib/db";
import { requireDealer } from "@/lib/authz";

export type OwnStore = {
  id: string;
  displayName: string;
  facilityType: string; // certified | designated | general
  certificationNo: string;
};

export async function ownPitStore(): Promise<{ store?: OwnStore; error?: string }> {
  const user = await requireDealer();
  if (!user.dealerId) return { error: "店舗アカウントでログインしてください" };
  const store = await prisma.pitStore.findUnique({
    where: { dealerId: user.dealerId },
    select: { id: true, displayName: true, facilityType: true, certificationNo: true, active: true },
  });
  if (!store) return { error: "この店舗はmbPITに登録されていません" };
  if (!store.active) return { error: "この店舗は現在ご利用いただけません（本部にお問い合わせください）" };
  return {
    store: {
      id: store.id,
      displayName: store.displayName,
      facilityType: store.facilityType,
      certificationNo: store.certificationNo,
    },
  };
}
