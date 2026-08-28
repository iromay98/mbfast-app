// 1ページ分のWP同期の共通コア。CLI（scripts/vpages-wp-push.mts）と
// 管理画面（/hq/vehicle-pages のサーバーアクション）の両方がこれを呼ぶ＝挙動の分岐を作らない。

import { prisma } from "../db";
import { generateVehiclePageEn, generateVehiclePageJp } from "./generate-html";
import { brandNameEn, brandUrlSlug, resolveVehiclePageData, variantFor } from "./resolve";
import { loadOptionDefs } from "./options-db";
import { menuItemsOf } from "./woo-jp";
import { toPrices } from "../prices/types";
import { toOptions } from "./options";
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

  // ── グレード統合グループ ──
  // 同一ブランドで pageGroup が同じJP行は1ページに統合。displayOrder最小が代表で、
  // 代表のページ行(slug/WPページ)がそのまま統合ページになる。非代表は同期対象外。
  let groupVehicles: (typeof v)[] = [];
  if (v.pageGroup) {
    groupVehicles = (await prisma.priceVehicle.findMany({
      where: { brandId: b.id, market: "JP", pageGroup: v.pageGroup },
      orderBy: { displayOrder: "asc" },
      include: { brand: true },
    })) as (typeof v)[];
    if (groupVehicles.length > 1 && groupVehicles[0].id !== v.id) {
      return [
        {
          level: "warn",
          message: `統合グループ「${v.pageGroup}」の非代表行のため、このページは生成しません（代表: ${groupVehicles[0].carName} ${groupVehicles[0].grade ?? ""}）。公開中なら「非表示」にしてください`,
        },
      ];
    }
  }

  const vehicleEn =
    p.enPriceMode === "price"
      ? await prisma.priceVehicle.findFirst({
          where: { brandId: b.id, market: "EN", carName: v.carName, grade: v.grade },
        })
      : null;
  const optionDefs = await loadOptionDefs();
  const data = resolveVehiclePageData(b, v, p, vehicleEn, optionDefs);

  // 見積りシミュレーター用の購入データ(JP)。価格マスタと同一ソース＝表示と課金がズレない
  const optionDefRows = await prisma.vehiclePageOption.findMany({ where: { enabled: true }, orderBy: { displayOrder: "asc" } });
  const purchaseFor = (vehicle: typeof v, pageOptions: unknown): import("./types").PurchaseData => {
    const all = menuItemsOf(b, toPrices(vehicle.prices)).map((m) => ({
      ...m,
      variationId: ((vehicle.wcMenuVariations ?? {}) as Record<string, number>)[m.key] ?? null,
    }));
    // TCUは単品施工ではなくオプション扱い(2026-08-28 更家さん指定・全メーカー共通)。
    // 決済単位(バリエーション)としては残し、UI上だけチェックボックス側に出す。
    const isTcu = (m: { key: string; label: string }) =>
      m.key.toLowerCase().includes("tcu") || m.label.toLowerCase().includes("tcu");
    const menus = all.filter((m) => !isTcu(m));
    const addons = all.filter(isTcu);
    const enabledOpts = toOptions(pageOptions);
    const options = optionDefRows
      .filter((d) => !d.derivedFrom)
      .filter((d) => (d.priceJpy ?? 0) > 0)
      .filter((d) => enabledOpts[d.key] === true)
      .map((d) => ({ key: d.key, label: d.labelJa, jpy: d.priceJpy as number, productId: d.wcProductIdJa ?? null }));
    return { menus, addons, options };
  };
  data.purchase = purchaseFor(v, p.options);
  data.pitStores = (
    await prisma.pitStore.findMany({
      where: { active: true },
      orderBy: { displayName: "asc" },
      select: { displayName: true, area: true },
    })
  ).map((st) => ({ name: st.displayName, area: st.area }));

  if (groupVehicles.length > 1) {
    const variants = [];
    for (const gv of groupVehicles) {
      const gvEn =
        p.enPriceMode === "price"
          ? await prisma.priceVehicle.findFirst({
              where: { brandId: b.id, market: "EN", carName: gv.carName, grade: gv.grade },
            })
          : null;
      variants.push(variantFor(b, gv, gvEn, p.enPriceMode));
    }
    // バリエーションごとの購入データ(価格・バリエーションIDは各行のもの)
    for (let i = 0; i < variants.length; i++) {
      const gv = groupVehicles[i];
      variants[i].purchase = purchaseFor(gv, gv.id === v.id ? p.options : p.options);
    }
    data.variants = variants;
    events.push({ level: "info", message: `統合グループ「${v.pageGroup}」: ${variants.length}バリエーションをタブ表示` });
  }
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
