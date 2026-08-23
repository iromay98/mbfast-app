/*
 * mbPIT 店舗マスター同期エンジン（アプリ → WordPress term meta）。
 * 価格同期（wp-sync.ts）と同じ設計: payloadHash による同一スキップ / dry-run /
 * sync_log / 書き込み後の読み戻し検証（送信しただけで成功にしない）。
 *
 * 安全弁:
 * - 書き込み前に必ず assertTermUnderMbpit で対象termが親545配下であることを検証
 *   （既存の代理店カテゴリツリーには構造的に書き込めない）
 * - 同期対象は SYNCED_META_FIELDS のみ（マッピング定義に無いカラムは送れない）
 * - 地図(mapUrl/lat/lng)はWP側に登録が無いため対象外＝LOCAL_ONLY_FIELDS
 * - active でない店舗・wpCategoryId 未採番の店舗は同期しない
 */
import { createHash } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import {
  STORE_META_FIELDS,
  SYNCED_META_FIELDS,
  buildMetaPayload,
  pickStoreInfo,
  type StoreInfo,
  type StoreMetaField,
} from "./store-meta";
import { assertTermUnderMbpit, wpConfigured, MBPIT_PARENT_CATEGORY_ID } from "./wordpress";

const BASE = process.env.WP_BASE_URL ?? "https://mbfasttuning.com";

/** 同期スキップ判定用ハッシュ（価格同期の payloadHash と同思想） */
export function storeMetaHash(info: StoreInfo): string {
  return createHash("sha256").update(JSON.stringify(buildMetaPayload(info))).digest("hex");
}

export type StoreDiff = {
  field: StoreMetaField;
  label: string;
  metaKey: string;
  oldValue: string; // WP側の現在値
  newValue: string; // アプリ側の値（送信予定）
};

export type StoreSyncResult = {
  status: "success" | "skipped" | "dry-run" | "failed" | "blocked";
  payloadHash: string;
  diffs: StoreDiff[];
  payload: Record<string, string>;
  error?: string;
};

function diffAgainstWp(wpMeta: Record<string, unknown>, payload: Record<string, string>): StoreDiff[] {
  const diffs: StoreDiff[] = [];
  for (const { field, label, metaKey } of SYNCED_META_FIELDS) {
    const oldValue = typeof wpMeta[metaKey] === "string" ? (wpMeta[metaKey] as string) : "";
    const newValue = payload[metaKey] ?? "";
    if (oldValue !== newValue) diffs.push({ field, label, metaKey, oldValue, newValue });
  }
  return diffs;
}

/**
 * 店舗情報をWPへ同期する。
 * - dryRun: WPを一切変更せず、送信予定ペイロードと差分だけ返す（ログは dry-run で記録）
 * - force: payloadHash が前回と同じでも送信する
 * - candidate: DBの値ではなく指定した値で差分/同期を行う（保存前プレビュー用。DBは変更しない）
 */
export async function syncStoreInfo(
  storeId: string,
  opts: { dryRun?: boolean; force?: boolean; candidate?: StoreInfo } = {},
): Promise<StoreSyncResult> {
  const empty = { diffs: [] as StoreDiff[], payload: {} as Record<string, string> };
  if (!wpConfigured()) {
    return { status: "blocked", payloadHash: "", ...empty, error: "WP_USER / WP_APP_PASSWORD が未設定です" };
  }
  const store = await prisma.pitStore.findUnique({ where: { id: storeId } });
  if (!store) return { status: "blocked", payloadHash: "", ...empty, error: "店舗が見つかりません" };
  if (store.wpCategoryId <= 0) {
    return { status: "blocked", payloadHash: "", ...empty, error: "WPカテゴリが未採番のため同期できません（店舗を承認してください）" };
  }
  if (!store.active) {
    return { status: "blocked", payloadHash: "", ...empty, error: "停止中の店舗は同期しません（有効化すると同期できます）" };
  }

  const info = opts.candidate ?? pickStoreInfo(store);
  const payload = buildMetaPayload(info);
  const payloadHash = storeMetaHash(info);

  // 同一ペイロードならスキップ（ingest 直後の無変更同期もここで「差分ゼロ」になる）
  if (!opts.dryRun && !opts.force && !opts.candidate) {
    const last = await prisma.pitStoreSyncLog.findFirst({
      where: { storeId, status: { in: ["success", "ingest"] } },
      orderBy: { createdAt: "desc" },
      select: { payloadHash: true },
    });
    if (last?.payloadHash === payloadHash) {
      await prisma.pitStoreSyncLog.create({ data: { storeId, payloadHash, status: "skipped" } });
      return { status: "skipped", payloadHash, diffs: [], payload };
    }
  }

  // 親545配下であることをWP側に確認（安全弁）＋ 現在値取得（差分・prevMeta用）
  let term;
  try {
    term = await assertTermUnderMbpit(store.wpCategoryId);
  } catch (e) {
    const error = e instanceof Error ? e.message : "対象カテゴリの検証に失敗しました";
    await prisma.pitStoreSyncLog.create({ data: { storeId, payloadHash, status: "failed", error } });
    return { status: "failed", payloadHash, diffs: [], payload, error };
  }
  const diffs = diffAgainstWp(term.meta ?? {}, payload);

  if (opts.dryRun || opts.candidate) {
    // プレビュー/dry-run: WPには一切書き込まない
    if (opts.dryRun) {
      await prisma.pitStoreSyncLog.create({
        data: { storeId, payloadHash, status: "dry-run", prevMeta: (term.meta ?? {}) as Prisma.InputJsonValue },
      });
    }
    return { status: "dry-run", payloadHash, diffs, payload };
  }

  // 書き込み（metaのみの部分更新）→ レスポンスの meta を検証
  try {
    const user = process.env.WP_USER;
    const pass = process.env.WP_APP_PASSWORD;
    const res = await fetch(`${BASE}/wp-json/wp/v2/categories/${store.wpCategoryId}`, {
      method: "POST",
      headers: {
        Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ meta: payload }),
    });
    const body = (await res.json().catch(() => null)) as { meta?: Record<string, unknown>; parent?: number } | null;
    if (!res.ok) {
      throw new Error(`WordPress API ${res.status}: ${JSON.stringify(body)?.slice(0, 200)}`);
    }
    // 読み戻し検証: 送った値がそのまま保存されているか（wp_kses等で変わる可能性がある）
    const savedMeta = body?.meta ?? (await assertTermUnderMbpit(store.wpCategoryId)).meta ?? {};
    /*
     * 読み戻し検証。
     * WordPressは保存時に & を &amp; へ変換する（sanitize由来）。これは正常な挙動で
     * 内容が変わったわけではないので、比較の前に実体参照を戻して突き合わせる。
     * これをやらないと「新車&中古車販売」のような普通の紹介文で必ず失敗する。
     */
    const unescape = (v: string) =>
      v
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#0?39;/g, "'")
        .replace(/&#8217;/g, "\u2019");
    const mismatch = SYNCED_META_FIELDS.filter(({ metaKey }) => {
      const saved = typeof savedMeta[metaKey] === "string" ? savedMeta[metaKey] : "";
      return unescape(saved) !== unescape(payload[metaKey] ?? "");
    });
    if (mismatch.length > 0) {
      const error = `保存値の検証に失敗: ${mismatch.map((m) => m.label).join("・")} がWP側で変更されています（HTML等が除去された可能性）`;
      await prisma.pitStoreSyncLog.create({
        data: { storeId, payloadHash, status: "failed", error, prevMeta: (term.meta ?? {}) as Prisma.InputJsonValue },
      });
      return { status: "failed", payloadHash, diffs, payload, error };
    }

    await prisma.$transaction([
      prisma.pitStoreSyncLog.create({
        data: { storeId, payloadHash, status: "success", prevMeta: (term.meta ?? {}) as Prisma.InputJsonValue },
      }),
      prisma.pitStore.update({ where: { id: storeId }, data: { lastSyncedAt: new Date() } }),
    ]);
    return { status: "success", payloadHash, diffs, payload };
  } catch (e) {
    const error = e instanceof Error ? e.message : "WordPressへの書き込みに失敗しました";
    await prisma.pitStoreSyncLog.create({
      data: { storeId, payloadHash, status: "failed", error, prevMeta: (term.meta ?? {}) as Prisma.InputJsonValue },
    });
    return { status: "failed", payloadHash, diffs, payload, error };
  }
}

/** 全店舗の一括同期/一括dry-run（連続書込は200ms間隔）。Step Dのラウンドトリップ検証にも使う */
export async function syncAllStores(opts: { dryRun?: boolean } = {}): Promise<
  { storeId: string; storeName: string; result: StoreSyncResult }[]
> {
  const stores = await prisma.pitStore.findMany({
    where: { active: true, wpCategoryId: { gt: 0 } },
    orderBy: { createdAt: "asc" },
    select: { id: true, displayName: true },
  });
  const out: { storeId: string; storeName: string; result: StoreSyncResult }[] = [];
  for (const s of stores) {
    const result = await syncStoreInfo(s.id, { dryRun: opts.dryRun });
    out.push({ storeId: s.id, storeName: s.displayName, result });
    await new Promise((r) => setTimeout(r, 200)); // レート制限（仕様 §5.2）
  }
  return out;
}

/** 店舗ページ・ポータルのURL（差分プレビューの「反映先」表示用） */
export function storeTargets(slug: string): { label: string; url: string }[] {
  return [
    { label: "店舗ページ", url: `${BASE}/mbpit/${slug}/` },
    { label: "mbPITポータル", url: `${BASE}/mbpit/` },
  ];
}

export { MBPIT_PARENT_CATEGORY_ID };
