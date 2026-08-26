// ハブページ（/tuning/ と /tuning/{brand}/）の同期。
// 車両ページと同じマーカー区間方式: 手書きの前書きがあってもマーカー内だけ差し替える。
// マーカーが無い（=空ページ）場合は全文として書き込む。

import { prisma } from "../db";
import { toColumns, toPrices } from "../prices/types";
import { brandNameEn, brandUrlSlug } from "./resolve";
import {
  buildBrandHubHtml,
  buildRootHubHtml,
  HUB_MARK_END,
  HUB_MARK_START,
  type HubBrandItem,
  type HubVehicleItem,
} from "./hub-html";
import { ensureParentPage, findPage, fetchPageRaw, updatePage, wpConfigured } from "./wp-sync";

export type HubSyncEvent = { level: "info" | "error"; message: string };

/** マーカー区間を差し替え。無ければ全文を置く */
function replaceMarked(existing: string, next: string): string {
  const s = existing.indexOf(HUB_MARK_START);
  const e = existing.indexOf(HUB_MARK_END);
  if (s >= 0 && e > s) {
    return existing.slice(0, s) + next + existing.slice(e + HUB_MARK_END.length);
  }
  return next;
}

/** Stage1後の出力文字列（"510ps"）を、車両ページと同じ計算で出す */
function tunedPsOf(stockOutput: string | null, stage1Gain: string | null): string | null {
  if (!stockOutput || !stage1Gain) return null;
  const stock = Number((stockOutput.match(/(\d+)\s*ps/i) ?? [])[1]);
  const gain = Number((stage1Gain.match(/\+?\s*(\d+)\s*ps/i) ?? [])[1]);
  if (!Number.isFinite(stock) || !Number.isFinite(gain)) return null;
  return `${stock + gain}ps`;
}

// 価格表ページのURL。ブランドのWPページIDからslug階層を引かず、既知の /price/ 階層に依存しない
// ため、WPのlinkフィールドを直接取得する
async function pricePageUrlOf(wordPressPageId: number | null): Promise<string | null> {
  if (!wordPressPageId) return null;
  try {
    const { wpGetJson } = await import("./wp-sync");
    const data = await wpGetJson<{ link?: string }>(`/pages/${wordPressPageId}?_fields=link`);
    return data.link ?? null;
  } catch {
    return null;
  }
}

/** 1ブランドのハブ（JP/EN）を更新。公開車両が0のブランドは触らない */
export async function syncBrandHub(brandId: string): Promise<HubSyncEvent[]> {
  const events: HubSyncEvent[] = [];
  if (!wpConfigured()) return [{ level: "error", message: "WP認証が未設定です" }];

  const brand = await prisma.priceBrand.findUnique({
    where: { id: brandId },
    include: {
      vehicles: {
        where: { market: "JP", page: { status: "publish" } },
        include: { page: true },
        orderBy: { displayOrder: "asc" },
      },
    },
  });
  if (!brand) return [{ level: "error", message: "ブランドが見つかりません" }];
  if (brand.vehicles.length === 0) return [{ level: "info", message: `${brand.displayName}: 公開車両なし（スキップ）` }];

  // グレード統合: 同じpageGroupは代表(先頭)だけを一覧に出す
  const seenGroups = new Set<string>();
  brand.vehicles = brand.vehicles.filter((v) => {
    if (!v.pageGroup) return true;
    if (seenGroups.has(v.pageGroup)) return false;
    seenGroups.add(v.pageGroup);
    return true;
  });

  const urlSlug = brandUrlSlug(brand.id, brand.slug);
  const nameEn = brandNameEn(brand.slug, brand.displayName);
  const pricePageUrl = await pricePageUrlOf(brand.wordPressPageId);

  for (const lang of ["ja", "en"] as const) {
    const jp = lang === "ja";
    const items: HubVehicleItem[] = brand.vehicles.map((v) => ({
      slug: v.page!.slug,
      carName: v.carName,
      grade: v.grade,
      stockOutput: v.stockOutput,
      tunedPs: tunedPsOf(v.stockOutput, v.stage1Gain),
      seriesGroup: v.seriesGroup,
      url: `${jp ? "" : "/en"}/tuning/${urlSlug}/${v.page!.slug}/`,
    }));
    const html = buildBrandHubHtml({
      jp,
      brandDisplayName: brand.displayName,
      brandNameEn: nameEn,
      vehicles: items,
      pricePageUrl: jp ? pricePageUrl : null, // 価格表はJPのみ
      rootUrl: jp ? "/tuning/" : "/en/tuning/",
    });
    const { brandId: pageId } = await ensureParentPage(urlSlug, jp ? `${brand.displayName} 車種別チューニングデータ` : `${nameEn} Tuning Data`, lang, true);
    if (!pageId) {
      events.push({ level: "error", message: `${brand.displayName}(${lang}): 親ページを特定できません` });
      continue;
    }
    const page = await fetchPageRaw(pageId);
    const next = replaceMarked(page.raw, html);
    if (page.raw === next) {
      events.push({ level: "info", message: `${brand.displayName}(${lang}): 変更なし` });
      continue;
    }
    await updatePage(pageId, { content: next });
    events.push({ level: "info", message: `${brand.displayName}(${lang}): ハブを更新（${brand.vehicles.length}車種）` });
  }
  return events;
}

/** ルートハブ /tuning/（JP/EN）: 公開車種数つきブランド一覧 */
export async function syncRootHub(): Promise<HubSyncEvent[]> {
  const events: HubSyncEvent[] = [];
  if (!wpConfigured()) return [{ level: "error", message: "WP認証が未設定です" }];

  const brands = await prisma.priceBrand.findMany({
    orderBy: { displayOrder: "asc" },
    include: { vehicles: { where: { market: "JP", page: { status: "publish" } }, select: { id: true } } },
  });

  for (const lang of ["ja", "en"] as const) {
    const jp = lang === "ja";
    const items: HubBrandItem[] = brands.map((b) => ({
      displayName: b.displayName,
      nameEn: brandNameEn(b.slug, b.displayName),
      urlSlug: brandUrlSlug(b.id, b.slug),
      url: `${jp ? "" : "/en"}/tuning/${brandUrlSlug(b.id, b.slug)}/`,
      count: b.vehicles.length,
    }));
    const html = buildRootHubHtml({ jp, brands: items });
    const tuning = await findPage("tuning", 0, lang);
    if (!tuning) {
      events.push({ level: "error", message: `/tuning/(${lang}) が見つかりません` });
      continue;
    }
    const page = await fetchPageRaw(tuning.id);
    const next = replaceMarked(page.raw, html);
    if (page.raw === next) {
      events.push({ level: "info", message: `/tuning/(${lang}): 変更なし` });
      continue;
    }
    await updatePage(tuning.id, { content: next });
    events.push({ level: "info", message: `/tuning/(${lang}): ハブを更新` });
  }
  return events;
}
