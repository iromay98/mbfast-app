"use server";

import { revalidatePath } from "next/cache";
import Papa from "papaparse";
import { prisma } from "@/lib/db";
import { requireHQ } from "@/lib/authz";
import { generatePriceTableHtml } from "@/lib/prices/generate-html";
import {
  REMOTE_TOOLS,
  toColumns,
  toPrices,
  toRemote,
  type BrandRow,
  type PriceMap,
  type RemoteFlags,
  type VehicleRow,
} from "@/lib/prices/types";

const PRICES_PATH = "/hq/prices";

// 1セル分の更新（Excel的なインライン編集）。price は prices(Json) の動的キーへ入れる。
export async function updateVehicleCell(
  vehicleId: string,
  patch: {
    field?: "carName" | "grade" | "engine" | "engineFamily" | "ecuType" | "stockOutput" | "stage1Gain" | "labor" | "shops" | "notes" | "seriesGroup";
    value?: string;
    priceKey?: string; // 価格列を更新するとき
    priceValue?: string;
    remote?: RemoteFlags; // リモートのトグル
  },
): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  const v = await prisma.priceVehicle.findUnique({
    where: { id: vehicleId },
    select: { id: true, prices: true, brandId: true },
  });
  if (!v) return { error: "行が見つかりません" };

  const data: Record<string, unknown> = {};

  if (patch.field) {
    const val = (patch.value ?? "").trim();
    // carName/seriesGroup/engine は必須扱い（空にしない）。他は空でクリア。
    if (patch.field === "carName" || patch.field === "seriesGroup") {
      if (!val) return { error: `${patch.field === "carName" ? "車種" : "シリーズ"}は空にできません` };
      data[patch.field] = val;
    } else if (patch.field === "engine") {
      data.engine = val;
    } else {
      data[patch.field] = val || null;
    }
  }

  if (patch.priceKey) {
    const prices = { ...((v.prices ?? {}) as PriceMap) };
    const raw = (patch.priceValue ?? "").trim();
    if (!raw) {
      delete prices[patch.priceKey]; // 空 = 未設定（表示はLINEボタン）
    } else if (/^ASK$/i.test(raw)) {
      prices[patch.priceKey] = "ASK";
    } else {
      // "¥165,000" や "'+22,000"（Airtable由来）→ 数字のみに寄せる。数字でなければ原文保持。
      const cleaned = raw.replace(/^'/, "").replace(/[¥￥,\s]/g, "");
      prices[patch.priceKey] = /^\d+$/.test(cleaned) ? cleaned : raw.replace(/^'/, "");
    }
    data.prices = prices;
  }

  if (patch.remote) data.remote = patch.remote;

  if (Object.keys(data).length === 0) return { ok: true };
  await prisma.priceVehicle.update({ where: { id: vehicleId }, data });
  revalidatePath(PRICES_PATH);
  return { ok: true };
}

// 行を追加（末尾）
export async function addVehicle(brandId: string): Promise<{ ok?: true; id?: string; error?: string }> {
  await requireHQ();
  const brand = await prisma.priceBrand.findUnique({
    where: { id: brandId },
    select: { seriesGroups: true },
  });
  if (!brand) return { error: "ブランドが見つかりません" };
  const last = await prisma.priceVehicle.findFirst({
    where: { brandId },
    orderBy: { displayOrder: "desc" },
    select: { displayOrder: true },
  });
  const created = await prisma.priceVehicle.create({
    data: {
      brandId,
      seriesGroup: brand.seriesGroups[0] ?? "",
      carName: "（新規）",
      displayOrder: (last?.displayOrder ?? -1) + 1,
    },
  });
  revalidatePath(PRICES_PATH);
  return { ok: true, id: created.id };
}

// 行を複製（すぐ下に挿入）
export async function duplicateVehicle(vehicleId: string): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  const src = await prisma.priceVehicle.findUnique({ where: { id: vehicleId } });
  if (!src) return { error: "行が見つかりません" };

  // 以降の行を1つ後ろへずらしてから挿入（順序を保つ）
  await prisma.priceVehicle.updateMany({
    where: { brandId: src.brandId, displayOrder: { gt: src.displayOrder } },
    data: { displayOrder: { increment: 1 } },
  });
  await prisma.priceVehicle.create({
    data: {
      brandId: src.brandId,
      seriesGroup: src.seriesGroup,
      carName: src.carName,
      grade: src.grade,
      engine: src.engine,
      engineFamily: src.engineFamily,
      ecuType: src.ecuType,
      stockOutput: src.stockOutput,
      stage1Gain: src.stage1Gain,
      prices: src.prices ?? {},
      labor: src.labor,
      shops: src.shops,
      remote: src.remote ?? {},
      notes: src.notes,
      displayOrder: src.displayOrder + 1,
    },
  });
  revalidatePath(PRICES_PATH);
  return { ok: true };
}

// 行を削除
export async function deleteVehicle(vehicleId: string): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  await prisma.priceVehicle.delete({ where: { id: vehicleId } });
  revalidatePath(PRICES_PATH);
  return { ok: true };
}

// 行の並び替え（1つ上/下へ）
export async function moveVehicle(
  vehicleId: string,
  dir: "up" | "down",
): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  const v = await prisma.priceVehicle.findUnique({
    where: { id: vehicleId },
    select: { id: true, brandId: true, displayOrder: true },
  });
  if (!v) return { error: "行が見つかりません" };
  const neighbor = await prisma.priceVehicle.findFirst({
    where:
      dir === "up"
        ? { brandId: v.brandId, displayOrder: { lt: v.displayOrder } }
        : { brandId: v.brandId, displayOrder: { gt: v.displayOrder } },
    orderBy: { displayOrder: dir === "up" ? "desc" : "asc" },
    select: { id: true, displayOrder: true },
  });
  if (!neighbor) return { ok: true }; // 端

  await prisma.$transaction([
    prisma.priceVehicle.update({ where: { id: v.id }, data: { displayOrder: neighbor.displayOrder } }),
    prisma.priceVehicle.update({ where: { id: neighbor.id }, data: { displayOrder: v.displayOrder } }),
  ]);
  revalidatePath(PRICES_PATH);
  return { ok: true };
}

// ブランド定義の更新（表示名・導入文・SEO・WPページID）
export async function updateBrand(
  brandId: string,
  patch: { displayName?: string; intro?: string; jsonLdDescription?: string; wordPressPageId?: number | null },
): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  const data: Record<string, unknown> = {};
  if (patch.displayName !== undefined) {
    const v = patch.displayName.trim();
    if (!v) return { error: "表示名は空にできません" };
    data.displayName = v;
  }
  if (patch.intro !== undefined) data.intro = patch.intro;
  if (patch.jsonLdDescription !== undefined) data.jsonLdDescription = patch.jsonLdDescription;
  if (patch.wordPressPageId !== undefined) data.wordPressPageId = patch.wordPressPageId;
  if (Object.keys(data).length === 0) return { ok: true };
  await prisma.priceBrand.update({ where: { id: brandId }, data });
  revalidatePath(PRICES_PATH);
  return { ok: true };
}

// 公開HTMLを生成して返す（プレビュー・コピー・DL用）
export async function generateBrandHtml(
  brandId: string,
): Promise<{ ok?: true; html?: string; filename?: string; error?: string }> {
  await requireHQ();
  const { brand, vehicles } = await loadBrandForHtml(brandId);
  if (!brand) return { error: "ブランドが見つかりません" };
  try {
    const html = generatePriceTableHtml(brand, vehicles);
    return { ok: true, html, filename: `${brand.slug.replace(/-/g, "_")}_price_table.html` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "生成に失敗しました" };
  }
}

async function loadBrandForHtml(brandId: string) {
  const b = await prisma.priceBrand.findUnique({
    where: { id: brandId },
    include: { vehicles: { orderBy: { displayOrder: "asc" } } },
  });
  if (!b) return { brand: null, vehicles: [] as VehicleRow[] };
  const brand: BrandRow = {
    id: b.id,
    displayName: b.displayName,
    slug: b.slug,
    namespacePrefix: b.namespacePrefix,
    seriesGroups: b.seriesGroups,
    columns: toColumns(b.columns),
    intro: b.intro ?? "",
    jsonLdDescription: b.jsonLdDescription ?? "",
    wordPressPageId: b.wordPressPageId,
    vehicleCount: b.vehicles.length,
  };
  const vehicles: VehicleRow[] = b.vehicles.map((v) => ({
    id: v.id,
    seriesGroup: v.seriesGroup,
    carName: v.carName,
    grade: v.grade,
    engine: v.engine,
    engineFamily: v.engineFamily,
    ecuType: v.ecuType,
    stockOutput: v.stockOutput,
    stage1Gain: v.stage1Gain,
    prices: toPrices(v.prices),
    labor: v.labor,
    shops: v.shops,
    remote: toRemote(v.remote),
    notes: v.notes,
    displayOrder: v.displayOrder,
  }));
  return { brand, vehicles };
}

// CSVエクスポート（Excelで開ける・再インポート可能な形）
export async function exportBrandCsv(
  brandId: string,
): Promise<{ ok?: true; csv?: string; filename?: string; error?: string }> {
  await requireHQ();
  const { brand, vehicles } = await loadBrandForHtml(brandId);
  if (!brand) return { error: "ブランドが見つかりません" };
  const priceKeys = brand.columns.filter((c) => c.type === "price").map((c) => c.key);
  const rows = vehicles.map((v) => {
    const base: Record<string, string> = {
      id: v.id,
      series: v.seriesGroup,
      car: v.carName,
      grade: v.grade ?? "",
      engine: v.engine,
      engineFamily: v.engineFamily ?? "",
      ecuType: v.ecuType ?? "",
      stockOutput: v.stockOutput ?? "",
      stage1Gain: v.stage1Gain ?? "",
    };
    for (const k of priceKeys) base[`price_${k}`] = v.prices[k] ?? "";
    base.labor = v.labor ?? "";
    base.shops = v.shops ?? "";
    base.remote = REMOTE_TOOLS.filter((t) => v.remote[t.key]).map((t) => t.badge).join("+");
    base.notes = v.notes ?? "";
    return base;
  });
  const csv = Papa.unparse(rows, { newline: "\r\n" });
  return { ok: true, csv: "﻿" + csv, filename: `${brand.slug}_prices.csv` };
}

// CSVインポート: id あり=更新 / id 空=新規追加。削除はしない（安全側）。
export async function importBrandCsv(
  brandId: string,
  csvText: string,
): Promise<{ ok?: true; updated?: number; created?: number; error?: string }> {
  await requireHQ();
  const brand = await prisma.priceBrand.findUnique({
    where: { id: brandId },
    select: { id: true, columns: true, seriesGroups: true },
  });
  if (!brand) return { error: "ブランドが見つかりません" };
  const priceKeys = toColumns(brand.columns).filter((c) => c.type === "price").map((c) => c.key);

  const parsed = Papa.parse<Record<string, string>>(csvText.replace(/^﻿/, ""), {
    header: true,
    skipEmptyLines: true,
  });
  if (parsed.errors.length > 0) {
    return { error: `CSV解析エラー: ${parsed.errors[0].message}（${parsed.errors[0].row ?? "?"}行目）` };
  }

  let updated = 0;
  let created = 0;
  const last = await prisma.priceVehicle.findFirst({
    where: { brandId },
    orderBy: { displayOrder: "desc" },
    select: { displayOrder: true },
  });
  let nextOrder = (last?.displayOrder ?? -1) + 1;

  for (const r of parsed.data) {
    if (!r.car?.trim() && !r.id?.trim()) continue;
    const prices: PriceMap = {};
    for (const k of priceKeys) {
      const raw = (r[`price_${k}`] ?? "").trim();
      if (!raw) continue;
      if (/^ASK$/i.test(raw)) prices[k] = "ASK";
      else {
        const cleaned = raw.replace(/^'/, "").replace(/[¥￥,\s]/g, "");
        prices[k] = /^\d+$/.test(cleaned) ? cleaned : raw.replace(/^'/, "");
      }
    }
    const remote: RemoteFlags = {};
    const badges = (r.remote ?? "").split("+").map((s) => s.trim()).filter(Boolean);
    for (const t of REMOTE_TOOLS) remote[t.key] = badges.includes(t.badge);

    const data = {
      seriesGroup: r.series?.trim() || brand.seriesGroups[0] || "",
      carName: r.car?.trim() || "（新規）",
      grade: r.grade?.trim() || null,
      engine: r.engine?.trim() ?? "",
      engineFamily: r.engineFamily?.trim() || null,
      ecuType: r.ecuType?.trim() || null,
      stockOutput: r.stockOutput?.trim() || null,
      stage1Gain: r.stage1Gain?.trim() || null,
      prices,
      labor: r.labor?.trim() || null,
      shops: r.shops?.trim() || null,
      remote: remote as object,
      notes: r.notes?.trim() || null,
    };

    const id = r.id?.trim();
    if (id) {
      const exists = await prisma.priceVehicle.findFirst({ where: { id, brandId }, select: { id: true } });
      if (!exists) return { error: `id が不正です（このブランドの行ではありません）: ${id}` };
      await prisma.priceVehicle.update({ where: { id }, data });
      updated++;
    } else {
      await prisma.priceVehicle.create({ data: { ...data, brandId, displayOrder: nextOrder++ } });
      created++;
    }
  }
  revalidatePath(PRICES_PATH);
  return { ok: true, updated, created };
}
