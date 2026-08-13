"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireHQ } from "@/lib/authz";
import { toOptions } from "@/lib/vehicle-pages/options";
import { ensureVehiclePageRow, seedVehiclePagesForBrand } from "@/lib/vehicle-pages/seed";
import { syncVehiclePage, type SyncEvent } from "@/lib/vehicle-pages/sync-core";
import { wpConfigured } from "@/lib/vehicle-pages/wp-sync";

const PATH = "/hq/vehicle-pages";

// 状態変更は、下書き/公開にした時点でその場でWPへ反映する（価格表グリッド側と同じ挙動）。
export async function updateVpageStatus(
  pageId: string,
  status: string,
): Promise<{ ok?: true; error?: string; syncWarning?: string }> {
  await requireHQ();
  if (!["hold", "draft", "publish"].includes(status)) return { error: "不正なstatus" };
  await prisma.vehiclePage.update({ where: { id: pageId }, data: { status } });
  let syncWarning: string | undefined;
  if (status !== "hold") {
    if (!wpConfigured()) syncWarning = "WP認証が未設定のため反映していません";
    else {
      try {
        const events = await syncVehiclePage(pageId);
        const failed = events.filter((e) => e.level === "error");
        if (failed.length > 0) syncWarning = failed.map((e) => e.message).join(" / ");
      } catch (e) {
        syncWarning = e instanceof Error ? e.message : "WP反映に失敗しました";
      }
    }
  }
  revalidatePath(PATH);
  return { ok: true, syncWarning };
}

/** ブランド内の「下書き/公開なのにWPページが未作成」の行をまとめて反映する */
export async function pushPendingVpagesForBrand(brandId: string): Promise<{ ok?: true; created?: number; failed?: number; error?: string }> {
  await requireHQ();
  if (!wpConfigured()) return { error: "WP認証が未設定です" };
  const targets = await prisma.vehiclePage.findMany({
    where: {
      vehicle: { brandId },
      status: { in: ["draft", "publish"] },
      OR: [{ wpPageIdJp: null }, { wpPageIdEn: null }],
    },
    select: { id: true },
  });
  let created = 0;
  let failed = 0;
  for (const t of targets) {
    try {
      const events = await syncVehiclePage(t.id);
      if (events.some((e) => e.level === "error")) failed++;
      else created++;
    } catch {
      failed++;
    }
  }
  revalidatePath(PATH);
  revalidatePath("/hq/prices");
  return { ok: true, created, failed };
}

export async function updateVpageOption(pageId: string, key: string, value: boolean | null): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  const p = await prisma.vehiclePage.findUnique({ where: { id: pageId }, select: { options: true } });
  if (!p) return { error: "行が見つかりません" };
  const options: Record<string, boolean> = { ...toOptions(p.options) };
  if (value === null) delete options[key];
  else options[key] = value;
  await prisma.vehiclePage.update({ where: { id: pageId }, data: { options } });
  revalidatePath(PATH);
  return { ok: true };
}

export async function updateVpageEnPriceMode(pageId: string, mode: string): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  if (!["quote", "price"].includes(mode)) return { error: "不正なmode" };
  await prisma.vehiclePage.update({ where: { id: pageId }, data: { enPriceMode: mode } });
  revalidatePath(PATH);
  return { ok: true };
}

export async function addVpageRelatedPost(pageId: string, wpPostId: number): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  const p = await prisma.vehiclePage.findUnique({ where: { id: pageId }, select: { relatedPosts: true } });
  if (!p) return { error: "行が見つかりません" };
  const base = process.env.WP_BASE_URL ?? "https://mbfasttuning.com";
  const res = await fetch(`${base}/wp-json/wp/v2/posts/${wpPostId}?_fields=id,link,title`);
  if (!res.ok) return { error: `WP記事 ${wpPostId} を取得できません (HTTP ${res.status})` };
  const post = (await res.json()) as { id: number; link: string; title: { rendered: string } };
  const list = Array.isArray(p.relatedPosts) ? (p.relatedPosts as { id?: number; title: string; url: string }[]) : [];
  if (!list.some((r) => r.id === post.id)) {
    list.push({ id: post.id, title: post.title.rendered, url: post.link });
    await prisma.vehiclePage.update({ where: { id: pageId }, data: { relatedPosts: list } });
  }
  revalidatePath(PATH);
  return { ok: true };
}

export async function removeVpageRelatedPost(pageId: string, wpPostId: number): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  const p = await prisma.vehiclePage.findUnique({ where: { id: pageId }, select: { relatedPosts: true } });
  if (!p) return { error: "行が見つかりません" };
  const list = (Array.isArray(p.relatedPosts) ? (p.relatedPosts as { id?: number }[]) : []).filter((r) => r.id !== wpPostId);
  await prisma.vehiclePage.update({ where: { id: pageId }, data: { relatedPosts: list } });
  revalidatePath(PATH);
  return { ok: true };
}

/** ページ行が無い車両（market=JP）に status=hold で行を用意する */
export async function seedVpagesForBrand(brandId: string): Promise<{ ok?: true; created?: number; error?: string }> {
  await requireHQ();
  const created = await seedVehiclePagesForBrand(brandId);
  revalidatePath(PATH);
  return { ok: true, created };
}

/** 1ページをWPへ同期（作成 or マーカー区間更新）。sync-core をそのまま使用 */
export async function pushVpage(pageId: string): Promise<{ ok?: true; events?: SyncEvent[]; error?: string }> {
  await requireHQ();
  if (!wpConfigured()) return { error: "WP認証が未設定です（本番コンテナでのみ実行可能）" };
  const events = await syncVehiclePage(pageId);
  revalidatePath(PATH);
  return { ok: true, events };
}

/* ── 価格グリッド（/hq/prices）からの操作。行が無ければ保留で自動作成してから更新 ── */

// 価格表グリッドからの高頻度操作。画面側で楽観的に更新するため、
// ここでは revalidatePath を呼ばない（毎タップでページ全体を再取得すると重いため）。
//
// 状態を 下書き/公開 にしたときは、その場でWPへ反映する（別画面での操作を不要にする）。
// WP側の失敗はDB保存とは切り離して返す＝状態変更自体は成功として扱う。
export async function setVpageStatusByVehicle(
  vehicleId: string,
  status: string,
): Promise<{ ok?: true; error?: string; syncWarning?: string }> {
  await requireHQ();
  if (!["hold", "draft", "publish"].includes(status)) return { error: "不正なstatus" };
  const row = await ensureVehiclePageRow(vehicleId);
  await prisma.vehiclePage.update({ where: { id: row.id }, data: { status } });
  if (status === "hold") return { ok: true };
  if (!wpConfigured()) return { ok: true, syncWarning: "WP認証が未設定のため反映していません" };
  try {
    const events = await syncVehiclePage(row.id);
    const failed = events.filter((e) => e.level === "error");
    if (failed.length > 0) return { ok: true, syncWarning: failed.map((e) => e.message).join(" / ") };
  } catch (e) {
    return { ok: true, syncWarning: e instanceof Error ? e.message : "WP反映に失敗しました" };
  }
  return { ok: true };
}

export async function setVpageOptionByVehicle(vehicleId: string, key: string, value: boolean | null): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  const row = await ensureVehiclePageRow(vehicleId);
  const options: Record<string, boolean> = { ...toOptions(row.options) };
  if (value === null) delete options[key];
  else options[key] = value;
  await prisma.vehiclePage.update({ where: { id: row.id }, data: { options } });
  return { ok: true };
}

/* ── オプション語彙マスタ（VehiclePageOption）の管理 ── */

export async function createOptionDef(input: {
  key: string;
  labelJa: string;
  labelEn: string;
  shortLabel?: string;
  derivedFrom?: string;
}): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  const key = input.key.trim();
  if (!/^[a-zA-Z][a-zA-Z0-9]*$/.test(key)) return { error: "キーは半角英字で始まる英数字にしてください（例: dragonAfterfire）" };
  if (!input.labelJa.trim() || !input.labelEn.trim()) return { error: "日本語名と英語名は必須です" };
  const dup = await prisma.vehiclePageOption.findUnique({ where: { key } });
  if (dup) return { error: `キー "${key}" は既に使われています` };
  const max = await prisma.vehiclePageOption.aggregate({ _max: { displayOrder: true } });
  await prisma.vehiclePageOption.create({
    data: {
      key,
      labelJa: input.labelJa.trim(),
      labelEn: input.labelEn.trim(),
      shortLabel: input.shortLabel?.trim() || null,
      derivedFrom: input.derivedFrom?.trim() || null,
      displayOrder: (max._max.displayOrder ?? 0) + 10,
    },
  });
  revalidatePath("/hq/prices");
  revalidatePath(PATH);
  return { ok: true };
}

export async function updateOptionDef(
  id: string,
  input: { labelJa?: string; labelEn?: string; shortLabel?: string | null; derivedFrom?: string | null; enabled?: boolean; displayOrder?: number },
): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  await prisma.vehiclePageOption.update({ where: { id }, data: input });
  revalidatePath("/hq/prices");
  revalidatePath(PATH);
  return { ok: true };
}

export async function moveOptionDef(id: string, dir: "up" | "down"): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  const all = await prisma.vehiclePageOption.findMany({ orderBy: { displayOrder: "asc" } });
  const i = all.findIndex((o) => o.id === id);
  if (i < 0) return { error: "見つかりません" };
  const j = dir === "up" ? i - 1 : i + 1;
  if (j < 0 || j >= all.length) return { ok: true };
  await prisma.$transaction([
    prisma.vehiclePageOption.update({ where: { id: all[i].id }, data: { displayOrder: all[j].displayOrder } }),
    prisma.vehiclePageOption.update({ where: { id: all[j].id }, data: { displayOrder: all[i].displayOrder } }),
  ]);
  revalidatePath("/hq/prices");
  revalidatePath(PATH);
  return { ok: true };
}

export async function deleteOptionDef(id: string): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  await prisma.vehiclePageOption.delete({ where: { id } });
  revalidatePath("/hq/prices");
  revalidatePath(PATH);
  return { ok: true };
}

/**
 * 価格表から自動で入ってしまったオプション値を消す（本部がタップしていない値の掃除）。
 * 判定: 保存されている値が「価格表から計算される値と一致する」キーだけを削除する。
 * 本部が意図的に同じ値を付けていた場合も消えるが、その場合は付け直せばよい（過剰に消さない設計）。
 */
export async function clearAutoFilledOptions(brandId: string): Promise<{ ok?: true; cleared?: number; error?: string }> {
  await requireHQ();
  const { deriveOptionsFromPrices, priceItemsFor } = await import("@/lib/vehicle-pages/resolve");
  const { loadOptionDefs } = await import("@/lib/vehicle-pages/options-db");
  const defs = await loadOptionDefs(true);
  const brand = await prisma.priceBrand.findUnique({
    where: { id: brandId },
    select: { id: true, displayName: true, slug: true, columns: true },
  });
  if (!brand) return { error: "ブランドが見つかりません" };

  const pages = await prisma.vehiclePage.findMany({
    where: { vehicle: { brandId } },
    include: { vehicle: true },
  });
  let cleared = 0;
  for (const p of pages) {
    const stored = toOptions(p.options);
    if (Object.keys(stored).length === 0) continue;
    const derived = deriveOptionsFromPrices(priceItemsFor(brand, p.vehicle), defs);
    const next: Record<string, boolean> = {};
    let changed = false;
    for (const [k, v] of Object.entries(stored)) {
      if (derived[k] === v) {
        changed = true; // 価格表から入った値とみなして落とす
        continue;
      }
      next[k] = v;
    }
    if (changed) {
      await prisma.vehiclePage.update({ where: { id: p.id }, data: { options: next } });
      cleared++;
    }
  }
  revalidatePath("/hq/prices");
  revalidatePath(PATH);
  return { ok: true, cleared };
}
