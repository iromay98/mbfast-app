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
  type ColumnDefinition,
  type ColumnType,
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
      // "¥165,000" や "'+22,000"（CSV/HTML由来）→ 数字のみに寄せる。数字でなければ原文保持。
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

// ── WordPress同期（Step C）──
// ブランドの紐づくページ単位で同期する（mercedes 2ブランドは1ページに同居のため一括）。

export async function previewWpSync(brandId: string): Promise<{ ok?: true; result?: import("@/server/prices/wp-sync").SyncResult; vpagesSynced?: number; error?: string }> {
  await requireHQ();
  const b = await prisma.priceBrand.findUnique({ where: { id: brandId }, select: { wordPressPageId: true } });
  if (!b?.wordPressPageId) return { error: "WordPressページIDが未設定です（ブランド設定で登録してください）" };
  const { syncWpPage } = await import("@/server/prices/wp-sync");
  const result = await syncWpPage(b.wordPressPageId, { dryRun: true });
  return { ok: true, result };
}

export async function publishWpSync(brandId: string, force = false): Promise<{ ok?: true; result?: import("@/server/prices/wp-sync").SyncResult; vpagesSynced?: number; error?: string }> {
  await requireHQ();
  const b = await prisma.priceBrand.findUnique({ where: { id: brandId }, select: { wordPressPageId: true } });
  if (!b?.wordPressPageId) return { error: "WordPressページIDが未設定です（ブランド設定で登録してください）" };
  const { syncWpPage } = await import("@/server/prices/wp-sync");
  const result = await syncWpPage(b.wordPressPageId, { dryRun: false, force });
  // 価格表を本番反映したタイミングで、新しい車両行のページ行(保留)を自動で用意する。
  // 保留=生成対象外なので、ここから勝手に公開されることはない（公開の判断は /hq/vehicle-pages）。
  const { seedVehiclePagesForBrand } = await import("@/lib/vehicle-pages/seed");
  await seedVehiclePagesForBrand(brandId);
  // さらに、このブランドの下書き・公開中の車両ページも同じ価格で自動更新する
  // （価格の変更が価格表と車両ページで食い違わないように）。1件の失敗で全体を止めない。
  const { syncVehiclePage } = await import("@/lib/vehicle-pages/sync-core");
  const targets = await prisma.vehiclePage.findMany({
    where: { status: { in: ["draft", "publish"] }, vehicle: { brandId } },
    select: { id: true },
  });
  let vpagesSynced = 0;
  for (const t of targets) {
    try {
      const events = await syncVehiclePage(t.id);
      if (events.some((e) => e.message.includes("更新") || e.message.includes("作成"))) vpagesSynced++;
    } catch {
      // 個別失敗はスキップ（次回反映かCLIで追いつく）
    }
  }
  revalidatePath(PRICES_PATH);
  revalidatePath("/hq/vehicle-pages");
  return { ok: true, result, vpagesSynced };
}

/**
 * 複数セルの一括更新（Excelからの貼り付け・下方向コピー用）。
 * 1回の呼び出しで扱う上限を設けて、事故と長時間ロックを防ぐ。
 * 値の正規化（¥やカンマ除去、ASK判定）は updateVehicleCell と同じ規則を使う。
 */
export async function bulkUpdateCells(
  updates: { vehicleId: string; field?: string; priceKey?: string; value: string }[],
): Promise<{ ok?: true; updated?: number; error?: string }> {
  await requireHQ();
  if (updates.length === 0) return { ok: true, updated: 0 };
  if (updates.length > 800) return { error: "一度に更新できるのは800セルまでです" };

  const TEXT_FIELDS = new Set([
    "carName",
    "grade",
    "engine",
    "engineFamily",
    "ecuType",
    "stockOutput",
    "stage1Gain",
    "labor",
    "shops",
    "notes",
    "seriesGroup",
  ]);

  // 車両ごとにまとめて1回のUPDATEにする（価格は同じ行で複数列が来るため）
  const byVehicle = new Map<string, { vehicleId: string; fields: Record<string, string>; prices: Record<string, string> }>();
  for (const u of updates) {
    const cur = byVehicle.get(u.vehicleId) ?? { vehicleId: u.vehicleId, fields: {}, prices: {} };
    if (u.field && TEXT_FIELDS.has(u.field)) cur.fields[u.field] = u.value;
    else if (u.priceKey) cur.prices[u.priceKey] = u.value;
    byVehicle.set(u.vehicleId, cur);
  }

  const ids = [...byVehicle.keys()];
  const rows = await prisma.priceVehicle.findMany({ where: { id: { in: ids } }, select: { id: true, prices: true, brandId: true } });
  const rowById = new Map(rows.map((r) => [r.id, r]));

  let updated = 0;
  const brandIds = new Set<string>();
  for (const item of byVehicle.values()) {
    const row = rowById.get(item.vehicleId);
    if (!row) continue;
    const data: Record<string, unknown> = {};

    for (const [field, rawValue] of Object.entries(item.fields)) {
      const val = rawValue.trim();
      if (field === "carName" || field === "seriesGroup") {
        if (!val) continue; // 必須項目は空にしない（その1セルだけ無視）
        data[field] = val;
      } else if (field === "engine") {
        data.engine = val;
      } else {
        data[field] = val || null;
      }
    }

    if (Object.keys(item.prices).length > 0) {
      const prices = { ...((row.prices ?? {}) as PriceMap) };
      for (const [key, rawValue] of Object.entries(item.prices)) {
        const raw = rawValue.trim();
        if (!raw) delete prices[key];
        else if (/^ASK$/i.test(raw)) prices[key] = "ASK";
        else {
          const cleaned = raw.replace(/^'/, "").replace(/[¥￥,\s]/g, "");
          prices[key] = /^\d+$/.test(cleaned) ? cleaned : raw.replace(/^'/, "");
        }
      }
      data.prices = prices;
    }

    if (Object.keys(data).length === 0) continue;
    await prisma.priceVehicle.update({ where: { id: item.vehicleId }, data });
    brandIds.add(row.brandId);
    updated++;
  }

  revalidatePath(PRICES_PATH);
  return { ok: true, updated };
}

/**
 * 新しいブランド（メーカー）を追加する。
 * 列定義・CSVマッピング・版面(layout)は既存ブランドから複製する＝表の見た目と
 * WP側の同期処理が既存と同じ規則で動く（ゼロから組ませない）。
 * 反映先のWPページIDは後からブランド設定で登録する。
 */
export async function createBrand(input: {
  id: string;
  displayName: string;
  slug: string;
  namespacePrefix: string;
  copyColumnsFromBrandId: string;
  wordPressPageId?: number | null;
}): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  const id = input.id.trim();
  const slug = input.slug.trim();
  // 接頭辞はCSS/ID衝突防止用で、テンプレートの規定は「小文字英数字+末尾ハイフン」（例: peugeot-）。
  // 入力にハイフンが無ければ自動で付ける（過去に "peugeot" のまま保存されHTML生成が落ちた）。
  let prefix = input.namespacePrefix.trim();
  if (prefix && !prefix.endsWith("-")) prefix = `${prefix}-`;
  if (!/^[a-z][a-z0-9_]*$/.test(id)) return { error: "IDは半角小文字の英数字とアンダースコア（例: peugeot）" };
  if (!/^[a-z0-9-]+$/.test(slug)) return { error: "slugは半角小文字の英数字とハイフン（例: peugeot）" };
  if (!/^[a-z0-9-]+-$/.test(prefix)) return { error: "接頭辞は半角小文字の英数字（末尾ハイフンは自動付与。例: peugeot）" };
  if (!input.displayName.trim()) return { error: "表示名は必須です" };

  const dupId = await prisma.priceBrand.findUnique({ where: { id } });
  if (dupId) return { error: `ID "${id}" は既に使われています` };
  const dupSlug = await prisma.priceBrand.findUnique({ where: { slug } });
  if (dupSlug) return { error: `slug "${slug}" は既に使われています` };

  const src = await prisma.priceBrand.findUnique({ where: { id: input.copyColumnsFromBrandId } });
  if (!src) return { error: "コピー元のブランドが見つかりません" };

  const maxOrder = await prisma.priceBrand.aggregate({ _max: { displayOrder: true } });

  await prisma.priceBrand.create({
    data: {
      id,
      displayName: input.displayName.trim(),
      slug,
      namespacePrefix: prefix,
      seriesGroups: [],
      columns: src.columns ?? [],
      csvMapping: src.csvMapping ?? {},
      intro: "",
      jsonLdDescription: "",
      wordPressPageId: input.wordPressPageId ?? null,
      blockIndex: 0,
      layout: src.layout ?? {},
      displayOrder: (maxOrder._max.displayOrder ?? 0) + 10,
    },
  });

  revalidatePath(PRICES_PATH);
  return { ok: true };
}

/**
 * ブランドの列定義の編集。
 * - 追加できるのは「価格列」か「既知のテキスト列」（ecuType 等）だけ。
 *   グリッド側の描画が列keyのswitchで書かれているため、未知のキーは追加させない。
 * - car / grade は表の土台なので削除・移動不可。
 */
const KNOWN_TEXT_COLUMNS: { key: string; label: string }[] = [
  { key: "engine", label: "エンジン" },
  { key: "ecuType", label: "ECU/TCU" },
  { key: "stock", label: "純正出力" },
  { key: "stage1-gain", label: "Stage1最大出力" },
  { key: "labor", label: "脱着・殻割工賃" },
  { key: "shops", label: "対応店舗" },
  { key: "remote", label: "リモート" },
];

export async function updateBrandColumns(
  brandId: string,
  columns: { key: string; label: string; type: string; order: number; emphasis?: string }[],
): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  const brand = await prisma.priceBrand.findUnique({ where: { id: brandId }, select: { columns: true } });
  if (!brand) return { error: "ブランドが見つかりません" };
  const current = toColumns(brand.columns);
  const byKey = new Map(current.map((c) => [c.key, c]));

  if (!columns.some((c) => c.key === "car")) return { error: "車種列は削除できません" };

  const seen = new Set<string>();
  const next = columns
    .map((c, i) => {
      if (seen.has(c.key)) return null;
      seen.add(c.key);
      const existing = byKey.get(c.key);
      if (existing) {
        // 既存列: ラベルと順序だけ更新（type等の内部設定は保持）
        return { ...existing, label: c.label.trim() || existing.label, order: i };
      }
      // 新規列: まず既知キー（ecuType等）に一致するか見る。送信された type が
      // 何であっても既知キーは既知列として扱う（価格列フォームに入れても正しく作る）。
      const known = KNOWN_TEXT_COLUMNS.find((k) => k.key === c.key || k.key.toLowerCase() === c.key.toLowerCase());
      if (known) {
        const t = known.key === "remote" ? "remote" : known.key === "ecuType" ? "ecu" : "text";
        return { key: known.key, label: c.label.trim() || known.label, type: t as ColumnType, order: i };
      }
      if (c.type === "price") {
        const key = c.key.trim().toLowerCase();
        if (!/^[a-z][a-z0-9-]*$/.test(key)) {
          return { error: `価格列のキーは半角小文字英数字とハイフンにしてください（例: stage2）: ${c.key}` } as const;
        }
        return { key, label: c.label.trim() || key, type: "price" as const, order: i, askBehavior: "line-btn" as const, emptyBehavior: "line-btn" as const };
      }
      return { error: `未対応の列キーです: ${c.key}` } as const;
    })
    .filter(Boolean) as (ColumnDefinition | { error: string })[];

  const err = next.find((c) => "error" in c) as { error: string } | undefined;
  if (err) return { error: err.error };

  await prisma.priceBrand.update({ where: { id: brandId }, data: { columns: next as object[] } });
  revalidatePath(PRICES_PATH);
  return { ok: true };
}

export async function knownAddableColumns(brandId: string): Promise<{ key: string; label: string; type: string }[]> {
  await requireHQ();
  const brand = await prisma.priceBrand.findUnique({ where: { id: brandId }, select: { columns: true } });
  const used = new Set(toColumns(brand?.columns).map((c) => c.key));
  return KNOWN_TEXT_COLUMNS.filter((k) => !used.has(k.key)).map((k) => ({ ...k, type: k.key === "remote" ? "remote" : k.key === "ecuType" ? "ecu" : "text" }));
}
