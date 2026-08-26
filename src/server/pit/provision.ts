import { prisma } from "@/lib/db";
import { GENRES } from "@/lib/mbpit-genres";
import {
  MBPIT_PARENT_CATEGORY_ID,
  createStoreCategory,
  createStorePage,
  findCategoryBySlug,
  findStorePage,
  wpConfigured,
} from "@/server/pit/wordpress";
import { syncStoreInfo } from "@/server/pit/store-sync";
import { isValidStoreSlug, normalizeStoreSlug, suggestStoreSlug } from "@/server/pit/store-slug";
import { sendPitWelcomeMail } from "@/server/pit/welcome-mail";

/*
 * 代理店 → mbPIT 店舗の自動付与（プロビジョニング）。**唯一の入口**。
 *
 * 呼び元: (1) 本部の代理店新規登録（createDealer）直後 (2) 代理店詳細の「mbPIT機能を付ける」
 *         (3) 既存代理店の一括遡り `scripts/pit-provision-dealers.mts`
 *
 * 決めごと（更家さん・2026-08-26）:
 *   - 代理店は mbPIT の月額を**免除**。PitStore.plan="dealer" で表す（課金実装時に無料扱い）
 *   - ブランド分離: 案内メールは mbPIT 名義のみ（welcome-mail.ts）
 *   - ジャンル初期値は「チューニング（エンジン・駆動系）」1つ。追加は本部がヒアリングして設定
 *   - slug は store-slug.ts の規則（ハイフン区切り・接尾辞禁止）。衝突は自動解決しない
 *   - 本体ブログ側の代理店カテゴリツリー（親355）には**一切触れない**
 *
 * 冪等: 既に PitStore がある代理店は何もしない（結果 status="exists"）。WPカテゴリ・店舗ページは
 *       同slugが545配下/19757配下にあれば再利用する。途中失敗しても再実行で続きから埋まる。
 */

export const DEALER_PLAN = "dealer";

/** ジャンル初期値（公式8ジャンルの先頭＝チューニング。定義はJSONが単一の正なのでラベルを引く） */
export function defaultDealerServiceTags(): string {
  const ecu = GENRES.find((g) => g.slug === "ecu");
  return ecu?.label ?? "";
}

export type ProvisionPlan = {
  dealerId: string;
  dealerName: string;
  slug: string; // 採用予定のslug（正規化済み）
  slugSource: "input" | "suggested" | "none";
  displayName: string;
  status: "ready" | "exists" | "blocked";
  existingStore?: { id: string; slug: string; wpCategoryId: number; wpPageId: number | null };
  /** 本部の判断が要る事項（blocked のとき必ず1つ以上） */
  issues: string[];
  /** 参考情報（進めてよいが知っておくべきこと） */
  notes: string[];
  /** WP側の再利用予定（既にある場合） */
  reuse: { categoryId?: number; pageId?: number };
};

/** 実行せずに、何が起きるかを判定する（画面・一括スクリプトのドライラン共用） */
export async function planPitProvision(dealerId: string, opts: { slug?: string; displayName?: string } = {}): Promise<ProvisionPlan> {
  const dealer = await prisma.dealer.findUnique({
    where: { id: dealerId },
    select: { id: true, name: true, pitStore: { select: { id: true, slug: true, wpCategoryId: true, wpPageId: true } } },
  });
  if (!dealer) throw new Error("代理店が見つかりません");

  const displayName = (opts.displayName ?? dealer.name).trim();
  const issues: string[] = [];
  const notes: string[] = [];
  const reuse: ProvisionPlan["reuse"] = {};

  if (dealer.pitStore) {
    return {
      dealerId,
      dealerName: dealer.name,
      slug: dealer.pitStore.slug,
      slugSource: "none",
      displayName,
      status: "exists",
      existingStore: dealer.pitStore,
      issues,
      notes: ["既にmbPIT店舗が紐付いています"],
      reuse,
    };
  }

  let slug = "";
  let slugSource: ProvisionPlan["slugSource"] = "none";
  if (opts.slug?.trim()) {
    slug = normalizeStoreSlug(opts.slug);
    slugSource = "input";
    if (slug !== opts.slug.trim().toLowerCase()) notes.push(`slugを規則に合わせて「${slug}」に正規化しました（接尾辞・記号を除去）`);
  } else {
    slug = suggestStoreSlug(dealer.name);
    slugSource = slug ? "suggested" : "none";
  }
  if (!slug || !isValidStoreSlug(slug)) {
    issues.push("slugを決められません（店名が日本語のみ等）。英小文字・数字・ハイフンで指定してください");
    return { dealerId, dealerName: dealer.name, slug, slugSource, displayName, status: "blocked", issues, notes, reuse };
  }

  const slugTaken = await prisma.pitStore.findUnique({ where: { slug }, select: { id: true, displayName: true } });
  if (slugTaken) issues.push(`slug「${slug}」はアプリ側で店舗「${slugTaken.displayName}」が使用中です`);

  if (!wpConfigured()) {
    issues.push("WP_USER / WP_APP_PASSWORD が未設定のためWordPress側を作れません");
  } else {
    const cat = await findCategoryBySlug(slug);
    if (cat) {
      if (cat.parent === MBPIT_PARENT_CATEGORY_ID) {
        reuse.categoryId = cat.id;
        notes.push(`WPカテゴリ「${cat.name}」(ID ${cat.id}) が既に545配下にあるため再利用します`);
      } else {
        issues.push(
          `slug「${slug}」はmbPIT外のカテゴリ「${cat.name}」(ID ${cat.id}・親${cat.parent}) が使用中です。` +
            `本体ブログ側のslugを変える（例: ハイフン無し表記）か、別のslugを指定してください。自動では変更しません`,
        );
      }
    }
    const page = await findStorePage(slug);
    if (page) {
      reuse.pageId = page.id;
      notes.push(`店舗ページ /mbpit/${slug}/ (ID ${page.id}) が既にあるため再利用します`);
    }
  }

  return {
    dealerId,
    dealerName: dealer.name,
    slug,
    slugSource,
    displayName,
    status: issues.length ? "blocked" : "ready",
    issues,
    notes,
    reuse,
  };
}

export type ProvisionResult = {
  ok: boolean;
  status: "created" | "exists" | "blocked" | "failed";
  storeId?: string;
  slug?: string;
  categoryId?: number;
  pageId?: number;
  pageUrl?: string;
  mailSent?: boolean;
  issues: string[];
  notes: string[];
  error?: string;
};

/**
 * 実行。plan が ready のときだけ書き込む。
 * 順序: PitStore(DB) → WPカテゴリ → 店舗ページ → 店舗情報のWP同期 → 案内メール。
 * DBを先に作るのは、WP側が途中で失敗しても再実行時に「slugが確定した店舗」として続きから埋めるため
 * （wpCategoryId=0 の店舗は投稿が止まる＝pipeline側が採番待ちとして扱う。既存の承認待ちと同じ状態）。
 */
export async function provisionPitForDealer(
  dealerId: string,
  opts: { slug?: string; displayName?: string; sendMail?: boolean } = {},
): Promise<ProvisionResult> {
  const plan = await planPitProvision(dealerId, opts);
  if (plan.status === "exists") {
    return { ok: true, status: "exists", storeId: plan.existingStore?.id, slug: plan.slug, issues: [], notes: plan.notes };
  }
  if (plan.status === "blocked") {
    return { ok: false, status: "blocked", slug: plan.slug, issues: plan.issues, notes: plan.notes };
  }

  const dealer = await prisma.dealer.findUnique({
    where: { id: dealerId },
    select: { name: true, email: true, address: true, phone: true, users: { select: { email: true }, orderBy: { createdAt: "asc" }, take: 1 } },
  });
  if (!dealer) return { ok: false, status: "failed", issues: [], notes: [], error: "代理店が見つかりません" };

  const notes = [...plan.notes];
  let store: { id: string };
  try {
    store = await prisma.pitStore.create({
      data: {
        dealerId,
        displayName: plan.displayName,
        slug: plan.slug,
        wpCategoryId: plan.reuse.categoryId ?? 0,
        wpPageId: plan.reuse.pageId ?? null,
        active: true,
        plan: DEALER_PLAN,
        serviceTags: defaultDealerServiceTags(),
        // 代理店マスタにある連絡先は初期値として写す（店舗が後から自分で直せる）
        address: dealer.address ?? "",
        tel: dealer.phone ?? "",
        email: dealer.email ?? "",
        // 自動生成記事は店舗が本文を見てから公開（代理店には投稿の練習期間が要るため既定ON）
        postReviewRequired: true,
      },
      select: { id: true },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, status: "failed", issues: [], notes, error: `店舗レコードの作成に失敗: ${msg.slice(0, 200)}` };
  }

  // ── WordPress側 ──
  let categoryId = plan.reuse.categoryId ?? 0;
  let pageId = plan.reuse.pageId ?? 0;
  let pageUrl: string | undefined;
  try {
    if (!categoryId) {
      categoryId = await createStoreCategory(plan.displayName, plan.slug);
      await prisma.pitStore.update({ where: { id: store.id }, data: { wpCategoryId: categoryId, wpCategorySlug: plan.slug } });
      notes.push(`WPカテゴリを作成 (ID ${categoryId})`);
    } else {
      await prisma.pitStore.update({ where: { id: store.id }, data: { wpCategorySlug: plan.slug } });
    }
    const page = await createStorePage({ name: plan.displayName, slug: plan.slug, categoryId });
    pageId = page.id;
    pageUrl = page.link;
    if (!page.reused) notes.push(`店舗ページを作成 (ID ${page.id})`);
    await prisma.pitStore.update({ where: { id: store.id }, data: { wpPageId: pageId } });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      status: "failed",
      storeId: store.id,
      slug: plan.slug,
      categoryId: categoryId || undefined,
      pageId: pageId || undefined,
      issues: [],
      notes,
      error: `店舗レコードは作成済み。WordPress側で失敗: ${msg.slice(0, 300)}（再実行で続きから作成します）`,
    };
  }

  // 店舗情報（ジャンル初期値・連絡先）をWP term metaへ投影。失敗しても開設自体は成功扱い
  try {
    const sync = await syncStoreInfo(store.id, { force: true });
    if (sync.status === "failed" || sync.status === "blocked") notes.push(`店舗情報のWP同期は保留: ${sync.error ?? sync.status}`);
  } catch (e) {
    notes.push(`店舗情報のWP同期に失敗（後で「店舗情報」から再同期）: ${e instanceof Error ? e.message : String(e)}`);
  }

  // 案内メール（mbPIT名義・保険的）
  let mailSent = false;
  const to = dealer.email ?? dealer.users[0]?.email ?? null;
  if (opts.sendMail !== false && to && pageUrl) {
    try {
      mailSent = await sendPitWelcomeMail({
        to,
        storeName: plan.displayName,
        storePageUrl: pageUrl,
        loginEmail: dealer.users[0]?.email ?? null,
      });
    } catch (e) {
      notes.push(`案内メールの送信に失敗: ${e instanceof Error ? e.message : String(e)}`);
    }
  } else if (!to) {
    notes.push("代理店にメールアドレスが無いため案内メールは送っていません");
  }

  return { ok: true, status: "created", storeId: store.id, slug: plan.slug, categoryId, pageId, pageUrl, mailSent, issues: [], notes };
}
