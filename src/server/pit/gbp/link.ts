/*
 * 加盟店 ⇄ Googleビジネスプロフィールのロケーションの紐付け（Step 2）。
 *
 * 原則:
 *  - 紐付けは**必ず人が選ぶ**。店名の表記ゆれで別の店に投稿する事故を防ぐため、
 *    このファイルに自動照合（名前の類似度で決める等）は一切置かない。
 *  - 1つのロケーションは1店舗にしか割り当てられない（PitStore.gbpLocationId が unique）。
 *  - 投稿の有効化(gbpPostingEnabled)は紐付けと別操作。既定は無効のまま。
 *  - 紐付け時のGoogle側の店名・住所を保存する（後から照合を疑えるようにする）。
 */
import { prisma } from "@/lib/db";
import {
  checkGbpConnection,
  configuredAccountId,
  configuredLocationMap,
  type GbpLocation,
  type GbpFailure,
} from "./client";

export type LinkableLocation = GbpLocation & {
  accountId: string;
  accountName: string;
  /** 既にこの店舗に割り当て済み（重複割り当てを画面で止めるため） */
  linkedStore: { id: string; displayName: string } | null;
};

export type StoreLinkRow = {
  id: string;
  displayName: string;
  slug: string;
  /** アプリ側の住所（Google側と目視で見比べるため） */
  address: string;
  active: boolean;
  gbpAccountId: string;
  gbpLocationId: string | null;
  gbpLocationName: string;
  gbpLocationAddr: string;
  gbpLinkedAt: Date | null;
  gbpPostingEnabled: boolean;
  /** GBP_LOCATION_MAP による手動指定（DBの紐付けが無いときの投稿先） */
  manualLocationId: string | null;
};

export async function listStoreLinks(): Promise<StoreLinkRow[]> {
  const rows = await prisma.pitStore.findMany({
    orderBy: [{ active: "desc" }, { displayName: "asc" }],
    select: {
      id: true,
      displayName: true,
      slug: true,
      address: true,
      active: true,
      gbpAccountId: true,
      gbpLocationId: true,
      gbpLocationName: true,
      gbpLocationAddr: true,
      gbpLinkedAt: true,
      gbpPostingEnabled: true,
    },
  });
  return rows.map((r) => ({ ...r, manualLocationId: manualTargetFor(r)?.locationId ?? null }));
}

/** Googleから取得できるロケーション一覧（紐付け画面の選択肢）。失敗理由も返す */
export async function listLinkableLocations(): Promise<
  { ok: true; locations: LinkableLocation[] } | GbpFailure
> {
  const conn = await checkGbpConnection();
  // 失敗はそのまま返す（HTTPステータス・error.status・details を画面で見せて原因を切り分ける）
  if (!conn.ok) return conn;

  const linked = await prisma.pitStore.findMany({
    where: { gbpLocationId: { not: null } },
    select: { id: true, displayName: true, gbpLocationId: true },
  });
  const byLocation = new Map(linked.map((s) => [s.gbpLocationId!, { id: s.id, displayName: s.displayName }]));

  const out: LinkableLocation[] = [];
  for (const { account, locations } of conn.accounts) {
    for (const l of locations) {
      out.push({
        ...l,
        accountId: account.name,
        accountName: account.accountName,
        linkedStore: byLocation.get(l.name) ?? null,
      });
    }
  }
  return { ok: true, locations: out };
}

export type LinkInput = {
  storeId: string;
  /** "accounts/123..." */
  accountId: string;
  /** "locations/456..." */
  locationId: string;
  locationName: string;
  locationAddr: string;
};

/** 人が選んだ結果を保存する。値の妥当性はここで最後に検査する */
export async function linkStoreToLocation(
  input: LinkInput,
  actorUserId: string,
): Promise<{ ok?: true; error?: string }> {
  if (!/^accounts\/[0-9]+$/.test(input.accountId)) return { error: "アカウントIDの形式が不正です" };
  if (!/^locations\/[0-9]+$/.test(input.locationId)) return { error: "ロケーションIDの形式が不正です" };

  const store = await prisma.pitStore.findUnique({
    where: { id: input.storeId },
    select: { id: true, displayName: true },
  });
  if (!store) return { error: "店舗が見つかりません" };

  const taken = await prisma.pitStore.findFirst({
    where: { gbpLocationId: input.locationId, NOT: { id: input.storeId } },
    select: { displayName: true },
  });
  if (taken) {
    return { error: `このロケーションは既に「${taken.displayName}」に紐付いています。先に解除してください。` };
  }

  await prisma.pitStore.update({
    where: { id: input.storeId },
    data: {
      gbpAccountId: input.accountId,
      gbpLocationId: input.locationId,
      gbpLocationName: input.locationName,
      gbpLocationAddr: input.locationAddr,
      gbpLinkedAt: new Date(),
      gbpLinkedByUserId: actorUserId,
      // 紐付け直後は投稿を有効にしない（内容の確認体制ができてから本部が有効化する）
      gbpPostingEnabled: false,
    },
  });
  return { ok: true };
}

/** 紐付けの解除。投稿も同時に無効化する（外した先へ投稿し続けないため） */
export async function unlinkStore(storeId: string): Promise<{ ok?: true; error?: string }> {
  const store = await prisma.pitStore.findUnique({ where: { id: storeId }, select: { id: true } });
  if (!store) return { error: "店舗が見つかりません" };
  await prisma.pitStore.update({
    where: { id: storeId },
    data: {
      gbpAccountId: "",
      gbpLocationId: null,
      gbpLocationName: "",
      gbpLocationAddr: "",
      gbpLinkedAt: null,
      gbpLinkedByUserId: null,
      gbpPostingEnabled: false,
    },
  });
  return { ok: true };
}

/** 投稿の有効・無効。投稿先が決まっていない店舗は有効にできない */
export async function setGbpPostingEnabled(
  storeId: string,
  enabled: boolean,
): Promise<{ ok?: true; error?: string }> {
  const store = await prisma.pitStore.findUnique({
    where: { id: storeId },
    select: { id: true, slug: true, gbpLocationId: true },
  });
  if (!store) return { error: "店舗が見つかりません" };
  // 手動指定（GBP_LOCATION_MAP）でも投稿先は決まるので、それも紐付け済みとして扱う
  if (enabled && !store.gbpLocationId && !manualTargetFor(store)) {
    return { error: "先にGoogleのロケーションと紐付けてください（または GBP_LOCATION_MAP に追加）" };
  }
  await prisma.pitStore.update({ where: { id: storeId }, data: { gbpPostingEnabled: enabled } });
  return { ok: true };
}

export type GbpTarget = {
  accountId: string;
  locationId: string;
  /** db = 画面で紐付けた / env = GBP_LOCATION_MAP による手動指定 */
  source: "db" | "env";
};

/*
 * 環境変数による手動指定の解決（一覧APIを一切呼ばない経路）。
 * キーは slug か店舗ID。アカウントIDは GBP_ACCOUNT_ID を使う。
 */
export function manualTargetFor(store: { id: string; slug: string }): GbpTarget | null {
  const accountId = configuredAccountId();
  if (!accountId) return null;
  const map = configuredLocationMap();
  const locationId = map.get(store.slug) ?? map.get(store.id);
  return locationId ? { accountId, locationId, source: "env" } : null;
}

/*
 * 投稿先として使える店舗か（Step 3 の投稿処理はこの関数を必ず通す）。
 * 店舗が有効・投稿が有効、が前提。投稿先はDBの紐付けを優先し、無ければ手動指定を見る。
 * **gbpPostingEnabled が false の店舗は、手動指定があっても投稿先にしない。**
 */
export async function gbpTargetOf(storeId: string): Promise<GbpTarget | null> {
  const s = await prisma.pitStore.findUnique({
    where: { id: storeId },
    select: {
      id: true,
      slug: true,
      active: true,
      gbpAccountId: true,
      gbpLocationId: true,
      gbpPostingEnabled: true,
    },
  });
  if (!s || !s.active || !s.gbpPostingEnabled) return null;
  if (s.gbpLocationId && s.gbpAccountId) {
    return { accountId: s.gbpAccountId, locationId: s.gbpLocationId, source: "db" };
  }
  return manualTargetFor(s);
}
