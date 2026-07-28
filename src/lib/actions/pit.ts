"use server";

import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { requireHQ, requireDealer } from "@/lib/authz";
import { createStoreCategory, wpConfigured, fetchMbpitCategories } from "@/server/pit/wordpress";
import {
  KNOWN_WP_STORES,
  shortSlugOf,
  metaToStoreInfo,
  buildMetaPayload,
  validateStoreInfo,
  STORE_META_FIELDS,
  type StoreInfo,
} from "@/server/pit/store-meta";
import {
  storeMetaHash,
  syncStoreInfo,
  syncAllStores,
  storeTargets,
  type StoreSyncResult,
  type StoreDiff,
} from "@/server/pit/store-sync";
import { notify } from "@/server/notifications";

const PIT_PATH = "/hq/pit";

// 店舗マスタの作成・更新（本店のみ）。
// dealerId 空 = 本店直営（代理店に紐づけない店舗。本部が /hq/pit/post から投稿）。
// wpCategoryId 0以下 = WordPressに親545配下のカテゴリを自動作成してIDを取り込む。
export async function upsertPitStore(input: {
  id?: string;
  dealerId: string;
  displayName: string;
  slug: string;
  wpCategoryId: number;
  footerHtml: string;
  active: boolean;
}): Promise<{ ok?: true; error?: string; createdCategoryId?: number }> {
  await requireHQ();
  const displayName = input.displayName.trim();
  const slug = input.slug.trim().toLowerCase();
  if (!displayName) return { error: "表示名を入力してください" };
  if (!/^[a-z0-9-]+$/.test(slug)) return { error: "slugは英小文字・数字・ハイフンのみです" };

  const dealerId = input.dealerId.trim() || null;
  if (dealerId) {
    const dealer = await prisma.dealer.findUnique({ where: { id: dealerId }, select: { id: true } });
    if (!dealer) return { error: "代理店が見つかりません" };
  }

  let wpCategoryId = input.wpCategoryId;
  let createdCategoryId: number | undefined;
  if (!Number.isInteger(wpCategoryId) || wpCategoryId <= 0) {
    if (!wpConfigured()) {
      return { error: "WordPress接続が未設定のためカテゴリを自動作成できません。カテゴリIDを入力してください" };
    }
    try {
      wpCategoryId = await createStoreCategory(displayName, slug);
      createdCategoryId = wpCategoryId;
    } catch (e) {
      return { error: e instanceof Error ? e.message : "WordPressカテゴリの自動作成に失敗しました" };
    }
  }

  try {
    if (input.id) {
      await prisma.pitStore.update({
        where: { id: input.id },
        data: { dealerId, displayName, slug, wpCategoryId, footerHtml: input.footerHtml, active: input.active },
      });
    } else {
      await prisma.pitStore.create({
        data: { dealerId, displayName, slug, wpCategoryId, footerHtml: input.footerHtml, active: input.active },
      });
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("Unique constraint")) return { error: "その代理店またはslugは既に登録されています" };
    return { error: "保存に失敗しました" };
  }
  revalidatePath(PIT_PATH);
  return { ok: true, createdCategoryId };
}

// held投稿の処理（確認済みにする）。resolution はメモとして guardResult に追記。
export async function resolvePitHeld(
  postId: string,
  resolution: "dismissed",
  note?: string,
): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  const post = await prisma.pitPost.findUnique({ where: { id: postId }, select: { id: true, status: true, guardResult: true } });
  if (!post) return { error: "投稿が見つかりません" };
  if (post.status !== "held") return { error: "保留中の投稿ではありません" };
  await prisma.pitPost.update({
    where: { id: postId },
    data: {
      status: "failed",
      errorMessage: `本部確認済み（自動公開せず）${note ? `: ${note}` : ""}`,
    },
  });
  void resolution;
  revalidatePath(PIT_PATH);
  return { ok: true };
}

// ── mbPIT加盟店の自己登録・承認・停止 ──────────────────────────────

// 店舗の承認/再開（本部のみ・ワンタップ）。WPカテゴリ未作成なら親545配下に自動作成してから有効化する。
// pitOnlyアカウントが停止中（Dealer INACTIVE）ならログインも復活させる。
export async function approvePitStore(
  storeId: string,
): Promise<{ ok?: true; error?: string; createdCategoryId?: number }> {
  await requireHQ();
  const store = await prisma.pitStore.findUnique({
    where: { id: storeId },
    select: {
      id: true,
      displayName: true,
      slug: true,
      wpCategoryId: true,
      active: true,
      dealerId: true,
      dealer: { select: { pitOnly: true } },
    },
  });
  if (!store) return { error: "店舗が見つかりません" };

  let wpCategoryId = store.wpCategoryId;
  let createdCategoryId: number | undefined;
  if (wpCategoryId <= 0) {
    if (!wpConfigured()) {
      return { error: "WordPress接続が未設定のためカテゴリを自動作成できません" };
    }
    try {
      wpCategoryId = await createStoreCategory(store.displayName, store.slug);
      createdCategoryId = wpCategoryId;
    } catch (e) {
      return { error: e instanceof Error ? e.message : "WordPressカテゴリの自動作成に失敗しました" };
    }
  }
  await prisma.$transaction([
    prisma.pitStore.update({ where: { id: storeId }, data: { wpCategoryId, active: true } }),
    ...(store.dealerId && store.dealer?.pitOnly
      ? [prisma.dealer.update({ where: { id: store.dealerId }, data: { status: "ACTIVE" } })]
      : []),
  ]);
  revalidatePath(PIT_PATH);
  return { ok: true, createdCategoryId };
}

// 店舗の停止（本部のみ）。投稿を止め、mbPIT専用アカウントはログインも即失効させる。
// 公開登録制の要: 危ない店舗はここでワンタップ停止（既公開記事のWP側削除は手動）。
export async function suspendPitStore(storeId: string): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  const store = await prisma.pitStore.findUnique({
    where: { id: storeId },
    select: { id: true, dealerId: true, dealer: { select: { pitOnly: true } } },
  });
  if (!store) return { error: "店舗が見つかりません" };
  await prisma.$transaction([
    prisma.pitStore.update({ where: { id: storeId }, data: { active: false } }),
    ...(store.dealerId && store.dealer?.pitOnly
      ? [prisma.dealer.update({ where: { id: store.dealerId }, data: { status: "INACTIVE" } })]
      : []),
  ]);
  revalidatePath(PIT_PATH);
  return { ok: true };
}

// 加盟店の自己登録（公開ページ・ログイン不要）。誰でも登録でき、その場で自動承認される。
// 不適切な店舗は本部が suspendPitStore でワンタップ停止する運用（マチアプ方式）。
// 作成される Dealer は pitOnly=true — ブログ投稿以外の画面（ECU系）は一切見せない。
export async function registerPitStore(input: {
  storeName: string;
  slug: string;
  contactName: string;
  email: string;
  password: string;
  agreed: boolean; // 利用規約への同意（/pit/terms）
}): Promise<{ ok?: true; error?: string; approved?: boolean }> {
  const storeName = input.storeName.trim();
  const slug = input.slug.trim().toLowerCase();
  const contactName = input.contactName.trim();
  const email = input.email.trim().toLowerCase();

  if (!input.agreed) return { error: "利用規約への同意が必要です" };
  if (!storeName) return { error: "店舗名を入力してください" };
  if (!/^[a-z0-9-]{3,40}$/.test(slug)) {
    return { error: "店舗名の英数字表記は、英小文字・数字・ハイフンの3〜40文字にしてください" };
  }
  if (!contactName) return { error: "担当者名を入力してください" };
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { error: "メールアドレスの形式が正しくありません" };
  if (input.password.length < 8) return { error: "パスワードは8文字以上にしてください" };

  // スパム・大量登録の簡易ブレーキ（公開ページのため）。超えたら翌日まで新規登録を止める
  const recentSignups = await prisma.dealer.count({
    where: { pitOnly: true, createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
  });
  if (recentSignups >= 20) {
    return { error: "現在登録が集中しています。お手数ですが時間をおいてお試しください" };
  }

  const [slugTaken, emailTaken] = await Promise.all([
    prisma.pitStore.findUnique({ where: { slug }, select: { id: true } }),
    prisma.user.findUnique({ where: { email }, select: { id: true } }),
  ]);
  if (slugTaken) return { error: "この英数字表記は既に使われています。少し変えてみてください（例: 末尾に地名を追加）" };
  if (emailTaken) return { error: "このメールアドレスは既に登録されています" };

  const passwordHash = await bcrypt.hash(input.password, 10);
  let storeId: string | null = null;
  try {
    await prisma.$transaction(async (tx) => {
      const dealer = await tx.dealer.create({
        data: { name: storeName, email, pitOnly: true },
      });
      await tx.user.create({
        data: { email, name: contactName, passwordHash, role: "DEALER", dealerId: dealer.id },
      });
      const store = await tx.pitStore.create({
        data: { dealerId: dealer.id, displayName: storeName, slug, wpCategoryId: 0, active: false },
      });
      storeId = store.id;
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("Unique constraint")) return { error: "店舗名・slug・メールのいずれかが既に登録されています" };
    console.error("mbPIT: 加盟店の自己登録に失敗", e);
    return { error: "登録に失敗しました。時間をおいて再度お試しください" };
  }

  // 自動承認: 登録と同時にWPカテゴリを作成して有効化する（マチアプ方式・事後モデレーション）。
  // WP接続エラー時のみ「承認待ち」に落とす。
  let approved = false;
  if (storeId && wpConfigured()) {
    try {
      const catId = await createStoreCategory(storeName, slug);
      await prisma.pitStore.update({
        where: { id: storeId },
        data: { wpCategoryId: catId, active: true },
      });
      approved = true;
    } catch (e) {
      console.error("mbPIT: 自動承認（WPカテゴリ作成）に失敗。承認待ちのままにします", e);
    }
  }

  await notify({
    type: "PIT_STORE_APPLIED",
    title: approved ? "mbPIT 新規加盟店が登録されました（自動承認済み）" : "mbPIT 新規加盟店の登録（承認待ち）",
    message: approved
      ? `${storeName}（slug: ${slug} / 担当: ${contactName}）が登録し、自動承認されました。内容を確認し、問題があれば管理画面から停止してください。WordPress側の店舗ページ（/mbpit/${slug}/）の作成も忘れずに。`
      : `${storeName}（slug: ${slug} / 担当: ${contactName}）が登録しました。WPカテゴリ自動作成に失敗したため、管理画面から承認してください。`,
    link: PIT_PATH,
  });
  // 注意: ここで revalidatePath は呼ばない（登録ページ自体が再レンダリングされ完了画面が消えるため。
  // /hq/pit は force-dynamic なので不要）。
  return { ok: true, approved };
}

// ── 店舗マスター Step A: WordPress現在値の初期取込（WP→アプリ・1回だけ実行） ──────
// 既存店舗の term meta を読み取り、アプリの PitStore に吸い上げる。
// 以後はアプリが原本になり、WPは投影先（同期エンジンは Step C で実装）。

export type IngestRow = {
  storeName: string;
  termId: number;
  categorySlug: string;
  shortSlug: string;
  slugChanged: boolean;
  wpPageId: number | null;
  filledFields: number; // 取り込めた項目数（9項目中）
  error?: string;
};

export async function ingestPitStoreInfo(): Promise<{
  ok?: true;
  error?: string;
  rows?: IngestRow[];
  unmatchedTerms?: string[]; // 545配下にあるがアプリに店舗が無いカテゴリ
}> {
  await requireHQ();
  if (!wpConfigured()) return { error: "WP_USER / WP_APP_PASSWORD が未設定です" };

  let cats: Awaited<ReturnType<typeof fetchMbpitCategories>>;
  try {
    cats = await fetchMbpitCategories();
  } catch (e) {
    return { error: e instanceof Error ? e.message : "WordPressカテゴリの取得に失敗しました" };
  }

  const stores = await prisma.pitStore.findMany({
    where: { wpCategoryId: { gt: 0 } },
    select: { id: true, displayName: true, slug: true, wpCategoryId: true },
  });

  const rows: IngestRow[] = [];
  const matchedTermIds = new Set<number>();
  for (const store of stores) {
    const term = cats.find((c) => c.id === store.wpCategoryId);
    if (!term) {
      rows.push({
        storeName: store.displayName,
        termId: store.wpCategoryId,
        categorySlug: "",
        shortSlug: store.slug,
        slugChanged: false,
        wpPageId: null,
        filledFields: 0,
        error: "WP側の545配下にこのカテゴリIDが見つかりません",
      });
      continue;
    }
    matchedTermIds.add(term.id);
    const known = KNOWN_WP_STORES.find((k) => k.termId === term.id);
    const shortSlug = shortSlugOf(term.slug);
    const info = metaToStoreInfo(term.meta);
    const filledFields = Object.values(info).filter((v) => v !== "").length;
    try {
      await prisma.pitStore.update({
        where: { id: store.id },
        data: {
          slug: shortSlug,
          wpCategorySlug: term.slug,
          wpPageId: known?.pageId ?? undefined,
          ...info,
          lastSyncedAt: new Date(), // 取込直後はアプリ==WP
        },
      });
      await prisma.pitStoreSyncLog.create({
        data: {
          storeId: store.id,
          payloadHash: storeMetaHash(info),
          status: "ingest",
          prevMeta: buildMetaPayload(info),
        },
      });
      rows.push({
        storeName: store.displayName,
        termId: term.id,
        categorySlug: term.slug,
        shortSlug,
        slugChanged: store.slug !== shortSlug,
        wpPageId: known?.pageId ?? null,
        filledFields,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : "";
      rows.push({
        storeName: store.displayName,
        termId: term.id,
        categorySlug: term.slug,
        shortSlug,
        slugChanged: store.slug !== shortSlug,
        wpPageId: known?.pageId ?? null,
        filledFields,
        error: msg.includes("Unique constraint")
          ? `短slug「${shortSlug}」が他店舗と重複しています`
          : "保存に失敗しました",
      });
    }
  }

  const unmatchedTerms = cats
    .filter((c) => !matchedTermIds.has(c.id))
    .map((c) => `${c.name}（term ${c.id} / ${c.slug}）`);

  revalidatePath(PIT_PATH);
  return { ok: true, rows, unmatchedTerms };
}

// ── 店舗マスター Step B/C: 保存プレビュー → 確定保存＋即時同期 / dry-run ──────

export type StorePreview = {
  ok?: true;
  error?: string;
  fieldErrors?: Partial<Record<string, string>>;
  diffs?: StoreDiff[];
  payload?: Record<string, string>;
  targets?: { label: string; url: string }[];
  willSync?: boolean; // false = 保存はされるが同期対象外（停止中など）
  syncBlockReason?: string;
};

// 保存ボタン → 差分プレビュー（WPは一切変更しない）。
// 差分は「WP側の現在値 → 編集後の値」。確定時は commitStoreInfo を呼ぶ。
export async function previewStoreInfo(storeId: string, info: StoreInfo): Promise<StorePreview> {
  await requireHQ();
  return previewCore(storeId, info);
}

async function previewCore(storeId: string, info: StoreInfo): Promise<StorePreview> {
  const fieldErrors = validateStoreInfo(info);
  if (Object.keys(fieldErrors).length > 0) return { error: "入力内容を確認してください", fieldErrors };

  const store = await prisma.pitStore.findUnique({
    where: { id: storeId },
    select: { slug: true, active: true, wpCategoryId: true },
  });
  if (!store) return { error: "店舗が見つかりません" };

  const targets = storeTargets(store.slug);
  if (!store.active || store.wpCategoryId <= 0) {
    return {
      ok: true,
      diffs: [],
      payload: buildMetaPayload(info),
      targets,
      willSync: false,
      syncBlockReason: !store.active ? "停止中のため保存のみ（同期しません）" : "WPカテゴリ未採番のため保存のみ（承認時に同期できます）",
    };
  }

  const r = await syncStoreInfo(storeId, { candidate: info });
  if (r.status === "failed" || r.status === "blocked") {
    return { error: r.error ?? "差分の取得に失敗しました" };
  }
  return { ok: true, diffs: r.diffs, payload: r.payload, targets, willSync: true };
}

// 確定: アプリDBへ保存（原本更新）→ WPへ即時同期。
// appOnly はWPへ送らないアプリ専用項目（本部のみ編集可。null = 変更しない）。
export async function commitStoreInfo(
  storeId: string,
  info: StoreInfo,
  appOnly: { contactPerson: string; internalNote: string },
): Promise<{ ok?: true; error?: string; sync?: { status: string; error?: string } }> {
  await requireHQ();
  return commitCore(storeId, info, appOnly);
}

async function commitCore(
  storeId: string,
  info: StoreInfo,
  appOnly: { contactPerson: string; internalNote: string } | null,
): Promise<{ ok?: true; error?: string; sync?: { status: string; error?: string }; diffs?: StoreDiff[] }> {
  const fieldErrors = validateStoreInfo(info);
  if (Object.keys(fieldErrors).length > 0) return { error: "入力内容を確認してください" };

  const store = await prisma.pitStore.findUnique({ where: { id: storeId }, select: { id: true } });
  if (!store) return { error: "店舗が見つかりません" };

  const data: Record<string, string> = appOnly
    ? { contactPerson: appOnly.contactPerson.trim(), internalNote: appOnly.internalNote.trim() }
    : {};
  for (const { field } of STORE_META_FIELDS) data[field] = (info[field] ?? "").trim();
  await prisma.pitStore.update({ where: { id: storeId }, data });

  // 即時同期（cron待ちなし）。失敗しても保存自体は成功（リトライは同期ボタンから）
  const r = await syncStoreInfo(storeId, {});
  revalidatePath(PIT_PATH);
  return { ok: true, sync: { status: r.status, error: r.error }, diffs: r.diffs };
}

// ── 加盟店による自己編集（自分の店舗のみ・slug/店舗名は変更不可） ──────

async function ownStoreId(): Promise<{ storeId?: string; storeName?: string; error?: string }> {
  const user = await requireDealer();
  const store = await prisma.pitStore.findUnique({
    where: { dealerId: user.dealerId },
    select: { id: true, displayName: true },
  });
  if (!store) return { error: "この店舗はmbPITに登録されていません" };
  return { storeId: store.id, storeName: store.displayName };
}

export async function previewMyStoreInfo(info: StoreInfo): Promise<StorePreview> {
  const own = await ownStoreId();
  if (!own.storeId) return { error: own.error };
  return previewCore(own.storeId, info);
}

export async function commitMyStoreInfo(
  info: StoreInfo,
): Promise<{ ok?: true; error?: string; sync?: { status: string; error?: string } }> {
  const own = await ownStoreId();
  if (!own.storeId) return { error: own.error };
  const r = await commitCore(own.storeId, info, null); // アプリ専用項目（担当者・社内メモ）は本部のみ
  if (r.ok) {
    // 本部へ差分付きで通知（事後モデレーション: 変な変更は /hq/pit から停止 or 上書き）
    const changed = (r.diffs ?? [])
      .map((d) => `${d.label}: ${d.oldValue || "（未設定）"} → ${d.newValue || "（削除）"}`)
      .join(" / ");
    await notify({
      type: "PIT_STORE_INFO_CHANGED",
      title: "mbPIT 店舗情報が変更されました",
      message: `${own.storeName} が店舗情報を変更しました。${changed || "（WP側との差分なし）"}`,
      link: PIT_PATH,
    });
    revalidatePath("/dealer/pit");
  }
  return { ok: r.ok, error: r.error, sync: r.sync };
}

// 単店舗の再同期/dry-run（失敗時のリトライ・送信ペイロード確認用）
export async function runStoreSync(
  storeId: string,
  dryRun: boolean,
): Promise<{ status: string; error?: string; diffs?: StoreDiff[]; payload?: Record<string, string> }> {
  await requireHQ();
  const r = await syncStoreInfo(storeId, { dryRun, force: !dryRun });
  revalidatePath(PIT_PATH);
  return { status: r.status, error: r.error, diffs: r.diffs, payload: r.payload };
}

// Step D: ラウンドトリップ検証（全active店舗をdry-run → 差分ゼロが期待値）
export type RoundtripRow = { storeName: string; status: string; diffCount: number; error?: string };
export async function roundtripCheck(): Promise<{ ok?: true; error?: string; rows?: RoundtripRow[] }> {
  await requireHQ();
  if (!wpConfigured()) return { error: "WP_USER / WP_APP_PASSWORD が未設定です" };
  const results = await syncAllStores({ dryRun: true });
  return {
    ok: true,
    rows: results.map((r) => ({
      storeName: r.storeName,
      status: r.result.status,
      diffCount: r.result.diffs.length,
      error: r.result.error,
    })),
  };
}
