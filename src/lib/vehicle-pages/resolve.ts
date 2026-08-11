// DBの行（PriceBrand / PriceVehicle / VehiclePage）→ 生成器入力（VehiclePageData）への解決。
// 価格ラベルは PriceBrand.columns の type=price（+labelから改行タグを除去）を唯一の原本にする
// ＝価格表とページでラベルが食い違わない。

import { toColumns, toPrices, toRemote } from "../prices/types";
import type { PriceItem, RelatedPost, VehiclePageData } from "./types";
import { toOptions } from "./options";

type BrandRowLike = {
  id: string;
  displayName: string;
  slug: string;
  columns: unknown;
};

type VehicleRowLike = {
  carName: string;
  grade: string | null;
  engine: string;
  ecuType: string | null;
  stockOutput: string | null;
  stage1Gain: string | null;
  prices: unknown;
  labor: string | null;
  remote: unknown;
  notes: string | null;
};

type PageRowLike = {
  slug: string;
  options: unknown;
  relatedPosts: unknown;
  enPriceMode: string;
};

export function priceItemsFor(brand: BrandRowLike, vehicle: VehicleRowLike): PriceItem[] {
  const cols = toColumns(brand.columns).filter((c) => c.type === "price");
  const prices = toPrices(vehicle.prices);
  return cols.map((c) => ({
    key: c.key,
    label: c.label.replace(/\s*\(.*?\)\s*$/, "").trim() || c.key,
    value: prices[c.key] ?? "",
  }));
}


function toRelated(v: unknown): RelatedPost[] {
  if (!Array.isArray(v)) return [];
  const out: RelatedPost[] = [];
  for (const item of v) {
    if (item && typeof item === "object" && typeof (item as RelatedPost).url === "string" && typeof (item as RelatedPost).title === "string") {
      out.push({ id: (item as RelatedPost).id, title: (item as RelatedPost).title, url: (item as RelatedPost).url });
    }
  }
  return out;
}

export function resolveVehiclePageData(
  brand: BrandRowLike,
  vehicleJp: VehicleRowLike,
  page: PageRowLike,
  vehicleEn: VehicleRowLike | null,
): VehiclePageData {
  const en: VehiclePageData["en"] =
    page.enPriceMode === "price" && vehicleEn
      ? { mode: "price", prices: priceItemsFor(brand, vehicleEn) }
      : { mode: "quote" };
  return {
    slug: page.slug,
    brandDisplayName: brand.displayName,
    brandNameEn: brandNameEn(brand.id, brand.displayName),
    brandSlug: brand.slug,
    carName: vehicleJp.carName,
    grade: vehicleJp.grade,
    engine: vehicleJp.engine,
    ecuType: vehicleJp.ecuType,
    stockOutput: vehicleJp.stockOutput,
    stage1Gain: vehicleJp.stage1Gain,
    prices: priceItemsFor(brand, vehicleJp),
    labor: vehicleJp.labor,
    remote: toRemote(vehicleJp.remote),
    notes: vehicleJp.notes,
    options: toOptions(page.options),
    related: toRelated(page.relatedPosts),
    en,
  };
}

/** carName+grade → slug（"C(W204)" + "C63AMG" → "c-w204-c63amg"） */
export function vehicleSlug(carName: string, grade: string | null): string {
  const base = [carName, grade].filter(Boolean).join(" ");
  return base
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-");
}

/**
 * ブランドの**URL用**slug。PriceBrand.slug はDB上の短縮形（mb / mbd / lambo 等）だが、
 * 公開URLは検索語に一致するフルネームにする（/tuning/mercedes-benz/ 等）。
 * ここに無いブランドは PriceBrand.slug をそのまま使う。
 */
const BRAND_URL_SLUGS: Record<string, string> = {
  mb: "mercedes-benz",
  mbd: "mercedes-benz-diesel",
  lambo: "lamborghini",
  cdj: "chrysler-dodge-jeep",
  fuso: "mitsubishi-fuso",
};

export function brandUrlSlug(brandId: string, brandSlug: string): string {
  return BRAND_URL_SLUGS[brandId] ?? brandSlug;
}

/** ブランドの英語名（EN側タイトル・本文用。displayNameは日本語のことがある） */
const BRAND_EN_NAMES: Record<string, string> = {
  mb: "Mercedes-Benz",
  mbd: "Mercedes-Benz Diesel",
  lambo: "Lamborghini",
  bmw: "BMW",
  audi: "Audi",
  ferrari: "Ferrari",
  cdj: "Chrysler / Dodge / Jeep",
  fuso: "Mitsubishi Fuso",
};

export function brandNameEn(brandId: string, displayName: string): string {
  if (BRAND_EN_NAMES[brandId]) return BRAND_EN_NAMES[brandId];
  // displayNameがASCIIならそのまま、日本語ならURL slugを整形
  if (/^[\x20-\x7e]+$/.test(displayName)) return displayName;
  const slug = BRAND_URL_SLUGS[brandId] ?? brandId;
  return slug.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}
