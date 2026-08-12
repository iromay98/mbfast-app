"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireHQ } from "@/lib/authz";
import { toOptions } from "@/lib/vehicle-pages/options";
import { ensureVehiclePageRow, seedVehiclePagesForBrand } from "@/lib/vehicle-pages/seed";
import { syncVehiclePage, type SyncEvent } from "@/lib/vehicle-pages/sync-core";
import { wpConfigured } from "@/lib/vehicle-pages/wp-sync";

const PATH = "/hq/vehicle-pages";

export async function updateVpageStatus(pageId: string, status: string): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  if (!["hold", "draft", "publish"].includes(status)) return { error: "不正なstatus" };
  await prisma.vehiclePage.update({ where: { id: pageId }, data: { status } });
  revalidatePath(PATH);
  return { ok: true };
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

export async function setVpageStatusByVehicle(vehicleId: string, status: string): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  if (!["hold", "draft", "publish"].includes(status)) return { error: "不正なstatus" };
  const row = await ensureVehiclePageRow(vehicleId);
  await prisma.vehiclePage.update({ where: { id: row.id }, data: { status } });
  revalidatePath("/hq/prices");
  revalidatePath(PATH);
  return { ok: true };
}

export async function setVpageOptionByVehicle(vehicleId: string, key: string, value: boolean | null): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  const row = await ensureVehiclePageRow(vehicleId);
  const options: Record<string, boolean> = { ...toOptions(row.options) };
  if (value === null) delete options[key];
  else options[key] = value;
  await prisma.vehiclePage.update({ where: { id: row.id }, data: { options } });
  revalidatePath("/hq/prices");
  revalidatePath(PATH);
  return { ok: true };
}
