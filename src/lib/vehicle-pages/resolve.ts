// DBの行（PriceBrand / PriceVehicle / VehiclePage）→ 生成器入力（VehiclePageData）への解決。
// 価格ラベルは PriceBrand.columns の type=price（+labelから改行タグを除去）を唯一の原本にする
// ＝価格表とページでラベルが食い違わない。

import { toColumns, toPrices, toRemote } from "../prices/types";
import type { PriceItem, RelatedPost, VehicleOptions, VehiclePageData } from "./types";

type BrandRowLike = {
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

function toOptions(v: unknown): VehicleOptions {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const o = v as Record<string, unknown>;
  const out: VehicleOptions = {};
  for (const k of ["babble", "coldStartOff", "idlingStopOff", "mapSwitch", "ecuUnlock", "limiterCut", "tcu"] as const) {
    if (typeof o[k] === "boolean") out[k] = o[k] as boolean;
  }
  return out;
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
