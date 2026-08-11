// 1ページ分のWP同期の共通コア。CLI（scripts/vpages-wp-push.mts）と
// 管理画面（/hq/vehicle-pages のサーバーアクション）の両方がこれを呼ぶ＝挙動の分岐を作らない。

import { prisma } from "../db";
import { generateVehiclePageEn, generateVehiclePageJp } from "./generate-html";
import { brandNameEn, brandUrlSlug, resolveVehiclePageData } from "./resolve";
import {
  createPage,
  ensureParentPage,
  fetchPageRaw,
  findUnsafeScriptContent,
  replaceMarkedRegion,
  updatePage,
} from "./wp-sync";

export type SyncEvent = { level: "info" | "warn" | "error"; message: string };

const parentCache = new Map<string, number>();

async function brandParentId(brandSlug: string, brandName: string, lang: "ja" | "en", events: SyncEvent[]): Promise<number> {
  const key = `${lang}:${brandSlug}`;
  const hit = parentCache.get(key);
  if (hit) return hit;
  const title = lang === "en" ? `${brandName} Tuning Data by Model` : `${brandName} 車種別チューニングデータ`;
  const { brandId, created } = await ensureParentPage(brandSlug, title, lang, true);
  if (!brandId) throw new Error(`親ページの用意に失敗: ${lang}/${brandSlug}`);
  for (const c of created) events.push({ level: "info", message: `親ページ作成: ${c}` });
  parentCache.set(key, brandId);
  return brandId;
}

/**
 * VehiclePage 1件をWPへ同期する（status=hold は呼び出し側で除外すること）。
 * 新規ならページ作成してIDをDBへ書き戻し、既存ならマーカー区間差し替え＋status合わせ。
 */
export async function syncVehiclePage(pageId: string): Promise<SyncEvent[]> {
  const events: SyncEvent[] = [];
  const p = await prisma.vehiclePage.findUnique({
    where: { id: pageId },
    include: { vehicle: { include: { brand: true } } },
  });
  if (!p) return [{ level: "error", message: "ページ行が見つかりません" }];
  if (p.status === "hold") return [{ level: "warn", message: "status=hold のため対象外" }];

  const v = p.vehicle;
  const b = v.brand;
  const vehicleEn =
    p.enPriceMode === "price"
      ? await prisma.priceVehicle.findFirst({
          where: { brandId: b.id, market: "EN", carName: v.carName, grade: v.grade },
        })
      : null;
  const data = resolveVehiclePageData(b, v, p, vehicleEn);
  const jp = generateVehiclePageJp(data);
  const en = generateVehiclePageEn(data);
  const wpStatus = p.status === "publish" ? "publish" : "draft";
  const urlSlug = brandUrlSlug(b.id, b.slug);

  // ── JP ──
  const jpBad = findUnsafeScriptContent(jp.html);
  if (jpBad) {
    events.push({ level: "error", message: `[JP] スキップ（script内アンパサンド）: ${jpBad}` });
  } else if (!p.wpPageIdJp) {
    const parent = await brandParentId(urlSlug, b.displayName, "ja", events);
    const page = await createPage({ slug: p.slug, parent, title: jp.title, content: jp.html, status: wpStatus, lang: "ja" });
    await prisma.vehiclePage.update({ where: { id: p.id }, data: { wpPageIdJp: page.id } });
    p.wpPageIdJp = page.id;
    events.push({ level: "info", message: `[JP] 作成 page=${page.id} status=${wpStatus}` });
  } else {
    const current = await fetchPageRaw(p.wpPageIdJp);
    const { next } = replaceMarkedRegion(current.raw, jp.html);
    const fields: { content?: string; title?: string; status?: "draft" | "publish" } = {};
    if (next !== current.raw) fields.content = next;
    if (current.status !== wpStatus) fields.status = wpStatus;
    if (Object.keys(fields).length > 0) {
      await updatePage(p.wpPageIdJp, fields);
      events.push({ level: "info", message: `[JP] 更新 page=${p.wpPageIdJp}${fields.status ? ` status→${wpStatus}` : ""}` });
    } else {
      events.push({ level: "info", message: `[JP] 一致 page=${p.wpPageIdJp}` });
    }
  }

  // ── EN ──
  const enBad = findUnsafeScriptContent(en.html);
  if (enBad) {
    events.push({ level: "error", message: `[EN] スキップ（script内アンパサンド）: ${enBad}` });
  } else if (!p.wpPageIdEn) {
    if (!p.wpPageIdJp) {
      events.push({ level: "error", message: "[EN] スキップ（JPページ未作成のため紐付け不可）" });
    } else {
      const parent = await brandParentId(urlSlug, brandNameEn(b.id, b.displayName), "en", events);
      const page = await createPage({
        slug: p.slug,
        parent,
        title: en.title,
        content: en.html,
        status: wpStatus,
        lang: "en",
        translationOfJp: p.wpPageIdJp,
      });
      await prisma.vehiclePage.update({ where: { id: p.id }, data: { wpPageIdEn: page.id } });
      events.push({ level: "info", message: `[EN] 作成 page=${page.id} status=${wpStatus}` });
    }
  } else {
    const current = await fetchPageRaw(p.wpPageIdEn);
    const { next } = replaceMarkedRegion(current.raw, en.html);
    const fields: { content?: string; status?: "draft" | "publish" } = {};
    if (next !== current.raw) fields.content = next;
    if (current.status !== wpStatus) fields.status = wpStatus;
    if (Object.keys(fields).length > 0) {
      await updatePage(p.wpPageIdEn, fields);
      events.push({ level: "info", message: `[EN] 更新 page=${p.wpPageIdEn}${fields.status ? ` status→${wpStatus}` : ""}` });
    } else {
      events.push({ level: "info", message: `[EN] 一致 page=${p.wpPageIdEn}` });
    }
  }

  return events;
}
