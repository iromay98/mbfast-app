/*
 * 「いまどの店舗として操作しているか」の解決。
 *
 *  - 加盟店（DEALER）… セッションの dealerId から解決する。**引数の storeId は無視する**
 *    （他店IDを渡されても自店に固定される＝店舗間で顧客情報が見えない保証を崩さない）
 *  - 本部（HQ_ADMIN）… storeId で任意の店舗として操作できる（代行入力・本店直営店舗の運用）。
 *    投稿の代行（/hq/pit/post）と同じ考え方。停止中の店舗も本部なら操作できる
 *
 * 画面・アクションはこの関数だけを通す（prisma.pitStore を直接引いて権限判定しない）。
 */
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/authz";

export type ActingStore = {
  id: string;
  slug: string;
  displayName: string;
  facilityType: string;
  certificationNo: string;
};

export type ActingContext = {
  store?: ActingStore;
  /** 監査ログ・修正履歴に残す実行者 */
  actor?: { id: string; role: "dealer" | "hq" };
  error?: string;
};

const SELECT = {
  id: true,
  slug: true,
  displayName: true,
  facilityType: true,
  certificationNo: true,
  active: true,
} as const;

export async function actingPitStore(storeId?: string): Promise<ActingContext> {
  const user = await getSessionUser();
  if (!user) return { error: "ログインしてください" };

  if (user.role === "HQ_ADMIN") {
    const id = (storeId ?? "").trim();
    if (!id) return { error: "店舗を選択してください" };
    const store = await prisma.pitStore.findUnique({ where: { id }, select: SELECT });
    if (!store) return { error: "店舗が見つかりません" };
    return { store: strip(store), actor: { id: user.id, role: "hq" } };
  }

  if (user.role !== "DEALER" || !user.dealerId) return { error: "店舗アカウントでログインしてください" };
  // 加盟店は自店のみ（引数は見ない）
  const store = await prisma.pitStore.findUnique({ where: { dealerId: user.dealerId }, select: SELECT });
  if (!store) return { error: "この店舗はmbPITに登録されていません" };
  if (!store.active) return { error: "この店舗は現在ご利用いただけません（本部にお問い合わせください）" };
  return { store: strip(store), actor: { id: user.id, role: "dealer" } };
}

function strip(s: { active: boolean } & ActingStore): ActingStore {
  return {
    id: s.id,
    slug: s.slug,
    displayName: s.displayName,
    facilityType: s.facilityType,
    certificationNo: s.certificationNo,
  };
}
