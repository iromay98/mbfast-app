// 日本語のWooCommerce商品の自動生成・同期。
//
// 設計(2026-08-26 更家さん合意):
//   - JP商品は「決済の器」。検索の受け皿は車両ページなので、JP商品は noindex +
//     Wooカタログ非表示(hidden)にして、車両ページの「申し込む」からのみ到達させる。
//   - 価格はアプリの価格マスタ(主要価格列)から取る＝手入力しない。EN商品で起きた
//     価格ズレをJP側では構造的に起こさない。
//   - グレード統合(pageGroup)の非代表行には作らない(代表に集約)。
//   - 既存のEN商品(brand+car+gradeが一致)があればPolylangの翻訳として紐付け、
//     言語スイッチャーを成立させる。
//
// WP API上の判明事項(2026-08-26 実験):
//   - wc/v3 POST products は lang:"ja" を受け付ける(言語割り当てOK)
//   - translations の紐付けは wc/v3 では効かず、wp/v2/product 経由で行う
//   - レスポンスにPHP警告が前置されることがある → 最初の { / [ まで読み飛ばす

import { prisma } from "../db";
import { toColumns, toPrices } from "../prices/types";

const BASE = process.env.WP_BASE_URL ?? "https://mbfasttuning.com";

function wpAuthHeader(): string {
  const user = process.env.WP_USER ?? "";
  const pass = process.env.WP_APP_PASSWORD ?? "";
  return "Basic " + Buffer.from(`${user}:${pass}`).toString("base64");
}

async function wpJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: wpAuthHeader(),
      "Content-Type": "application/json",
      "User-Agent": "curl/8.4.0",
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  const start = Math.min(...[text.indexOf("{"), text.indexOf("[")].filter((i) => i >= 0));
  if (!res.ok) throw new Error(`WP ${path} HTTP ${res.status}: ${text.slice(start, start + 200)}`);
  if (!Number.isFinite(start)) throw new Error(`WP ${path}: JSONが見つかりません`);
  return JSON.parse(text.slice(start)) as T;
}

/** 主要価格(円)を価格マスタから決める: emphasis=primary の列 → 無ければ最初の数値列 */
export function primaryPriceJpy(brand: { columns: unknown }, prices: Record<string, string>): number | null {
  const cols = toColumns(brand.columns).filter((c) => c.type === "price");
  const ordered = [...cols.filter((c) => c.emphasis === "primary"), ...cols.filter((c) => c.emphasis !== "primary")];
  for (const c of ordered) {
    const raw = prices[c.key];
    if (!raw) continue;
    const n = Number(String(raw).replace(/[^0-9]/g, ""));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

export type JpProductEvent = { level: "info" | "warn" | "error"; message: string };

export type MenuItem = { key: string; label: string; jpy: number };

/** 施工メニュー = 数値が入っている価格列(その車両で選べる決済単位)。ラベルの<br>は除去 */
export function menuItemsOf(brand: { columns: unknown }, prices: Record<string, string>): MenuItem[] {
  const out: MenuItem[] = [];
  for (const c of toColumns(brand.columns)) {
    if (c.type !== "price") continue;
    const raw = prices[c.key];
    if (!raw) continue;
    const n = Number(String(raw).replace(/[^0-9]/g, ""));
    if (!Number.isFinite(n) || n <= 0) continue;
    out.push({ key: c.key, label: c.label.replace(/<br\s*\/?\s*>/gi, ""), jpy: n });
  }
  return out;
}

/**
 * 1車両(JP行)のJP商品を作成/更新する。
 * 戻りは画面ログ用イベント。wcProductId を PriceVehicle に保存する。
 */
export async function syncJpProductForVehicle(vehicleId: string): Promise<JpProductEvent[]> {
  const events: JpProductEvent[] = [];
  const v = await prisma.priceVehicle.findUnique({ where: { id: vehicleId }, include: { brand: true, page: true } });
  if (!v) return [{ level: "error", message: "車両が見つかりません" }];
  if (v.market !== "JP") return [{ level: "error", message: "JP行ではありません" }];

  if (v.pageGroup) {
    const rep = await prisma.priceVehicle.findFirst({
      where: { brandId: v.brandId, market: "JP", pageGroup: v.pageGroup },
      orderBy: { displayOrder: "asc" },
      select: { id: true, carName: true, grade: true },
    });
    if (rep && rep.id !== v.id) {
      return [{ level: "warn", message: `統合グループの非代表行のためスキップ（代表: ${rep.carName} ${rep.grade ?? ""}）` }];
    }
  }

  const menu = menuItemsOf(v.brand, toPrices(v.prices));
  if (menu.length === 0) return [{ level: "warn", message: `${v.carName} ${v.grade ?? ""}: 価格未入力のためスキップ` }];

  const name = [v.brand.displayName, v.carName, v.grade ?? "", "ECUチューニング"].filter(Boolean).join(" ");
  const pageUrl = v.page ? `${BASE}/tuning/${v.brand.slug}/${v.page.slug}/` : null;
  const shortDesc = [
    `<p>${v.carName}${v.grade ? ` ${v.grade}` : ""}のECUチューニング施工(税込)。`,
    pageUrl ? `内容の詳細は<a href="${pageUrl}">車種ページ</a>をご覧ください。</p>` : "</p>",
  ].join("");

  // 可変商品: 属性「施工メニュー」で価格違いのバリエーションを持つ
  const payload = {
    name,
    type: "variable",
    status: "publish",
    catalog_visibility: "hidden",
    short_description: shortDesc,
    lang: "ja",
    attributes: [{ name: "施工メニュー", visible: true, variation: true, options: menu.map((m) => m.label) }],
  };

  let productId = v.wcProductId ?? null;
  if (productId) {
    await wpJson(`/wp-json/wc/v3/products/${productId}`, { method: "PUT", body: JSON.stringify(payload) });
  } else {
    const created = await wpJson<{ id: number }>(`/wp-json/wc/v3/products`, { method: "POST", body: JSON.stringify(payload) });
    productId = created.id;
    await prisma.priceVehicle.update({ where: { id: v.id }, data: { wcProductId: productId } });
  }

  const existing = await wpJson<{ id: number; attributes: { name: string; option: string }[] }[]>(
    `/wp-json/wc/v3/products/${productId}/variations?per_page=100`,
  );
  const byOption = new Map<string, number>();
  for (const ex of existing) {
    const opt = ex.attributes?.find((a) => a.name === "施工メニュー")?.option;
    if (opt) byOption.set(opt, ex.id);
  }
  const variationMap: Record<string, number> = {};
  for (const m of menu) {
    const body = JSON.stringify({ regular_price: String(m.jpy), attributes: [{ name: "施工メニュー", option: m.label }] });
    const hit = byOption.get(m.label);
    if (hit) {
      await wpJson(`/wp-json/wc/v3/products/${productId}/variations/${hit}`, { method: "PUT", body });
      variationMap[m.key] = hit;
      byOption.delete(m.label);
    } else {
      const created = await wpJson<{ id: number }>(`/wp-json/wc/v3/products/${productId}/variations`, { method: "POST", body });
      variationMap[m.key] = created.id;
    }
  }
  for (const [, orphanId] of byOption) {
    await wpJson(`/wp-json/wc/v3/products/${productId}/variations/${orphanId}?force=true`, { method: "DELETE" });
  }
  await prisma.priceVehicle.update({ where: { id: v.id }, data: { wcMenuVariations: variationMap } });
  events.push({ level: "info", message: `${name}: ${menu.length}メニュー (商品${productId})` });

  try {
    await wpJson(`/wp-json/wp/v2/product/${productId}`, {
      method: "POST",
      body: JSON.stringify({ aioseo_meta_data: { robots_default: false, robots_noindex: true } }),
    });
  } catch {
    events.push({ level: "warn", message: `${name}: noindex設定に失敗` });
  }

  const enTwin = await prisma.priceVehicle.findFirst({
    where: { brandId: v.brandId, market: "EN", carName: v.carName, grade: v.grade, wcProductId: { not: null } },
    select: { wcProductId: true },
  });
  if (enTwin?.wcProductId) {
    try {
      await wpJson(`/wp-json/wp/v2/product/${productId}`, {
        method: "POST",
        body: JSON.stringify({ lang: "ja", translations: { en: enTwin.wcProductId } }),
      });
    } catch {
      events.push({ level: "warn", message: `EN商品との紐付けに失敗` });
    }
  }

  return events;
}

/** オプション(derivedFromなし・料金あり)のJP決済用商品。全車共通の固定価格 */
export async function syncOptionProducts(): Promise<JpProductEvent[]> {
  const events: JpProductEvent[] = [];
  const defs = await prisma.vehiclePageOption.findMany({ where: { enabled: true }, orderBy: { displayOrder: "asc" } });
  for (const d of defs) {
    if (d.derivedFrom) continue;
    if (!d.priceJpy || d.priceJpy <= 0) continue;
    const payload = {
      name: `オプション: ${d.labelJa}`,
      type: "simple",
      status: "publish",
      catalog_visibility: "hidden",
      regular_price: String(d.priceJpy),
      lang: "ja",
    };
    if (d.wcProductIdJa) {
      await wpJson(`/wp-json/wc/v3/products/${d.wcProductIdJa}`, { method: "PUT", body: JSON.stringify(payload) });
    } else {
      const created = await wpJson<{ id: number }>(`/wp-json/wc/v3/products`, { method: "POST", body: JSON.stringify(payload) });
      await prisma.vehiclePageOption.update({ where: { id: d.id }, data: { wcProductIdJa: created.id } });
      events.push({ level: "info", message: `${d.labelJa}: 商品${created.id}を作成 (¥${d.priceJpy.toLocaleString()})` });
    }
  }
  return events;
}

/** ブランド一括: 公開中の車両ページを持つJP行(代表のみ)にJP商品を作成/更新 */
export async function syncJpProductsForBrand(brandId: string): Promise<{ done: number; skipped: number; failed: number; log: string[] }> {
  const vehicles = await prisma.priceVehicle.findMany({
    where: { brandId, market: "JP", page: { status: "publish" } },
    orderBy: { displayOrder: "asc" },
    select: { id: true },
  });
  let done = 0;
  let skipped = 0;
  let failed = 0;
  const log: string[] = [];
  try {
    for (const e of await syncOptionProducts()) if (e.level !== "info") log.push(e.message);
  } catch (e) {
    log.push("オプション商品の同期失敗: " + (e instanceof Error ? e.message.slice(0, 80) : ""));
  }
  for (const v of vehicles) {
    try {
      const events = await syncJpProductForVehicle(v.id);
      const hasError = events.some((e) => e.level === "error");
      const hasSkip = events.some((e) => e.level === "warn" && e.message.includes("スキップ"));
      if (hasError) failed++;
      else if (hasSkip) skipped++;
      else done++;
      for (const e of events) if (e.level !== "info") log.push(e.message);
    } catch (e) {
      failed++;
      log.push(e instanceof Error ? e.message.slice(0, 120) : "不明なエラー");
    }
  }
  return { done, skipped, failed, log: log.slice(0, 20) };
}
