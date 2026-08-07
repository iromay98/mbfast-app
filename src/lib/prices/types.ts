// 価格表の共有型。DBの Json 列（columns / prices / remote）の形をここで定義する。

export type ColumnType =
  | "price" // 価格（¥表示・空欄はLINEボタン）
  | "text" // 車種・グレード・エンジン等
  | "output" // 純正出力・出力向上
  | "labor" // 工賃
  | "shops" // 対応店舗
  | "remote" // リモート施工バッジ
  | "ecu"; // ECU/TCU型番

export type ColumnDefinition = {
  key: string; // "babble" / "stage1" / "car" 等
  label: string; // "バブリングのみ"
  labelHtml?: string; // 改行入り: "バブリング<br>のみ"
  type: ColumnType;
  emphasis?: "primary" | "secondary" | "muted";
  askBehavior?: "line-btn" | "as-is";
  emptyBehavior?: "line-btn" | "dash" | "dash-if-primary-filled";
  order: number;
};

// リモート施工の対応ツール
export type RemoteFlags = {
  autoTuner?: boolean;
  powerGate3?: boolean;
  flasher?: boolean;
  atOne?: boolean;
};

export const REMOTE_TOOLS: { key: keyof RemoteFlags; badge: string; title: string }[] = [
  { key: "powerGate3", badge: "PG3", title: "Powergate3" },
  { key: "flasher", badge: "Flasher", title: "IXI Flasher" },
  { key: "autoTuner", badge: "AT", title: "AutoTuner" },
  { key: "atOne", badge: "AT1", title: "AutoTuner One" },
];

// 価格は動的キー（ブランドごとに列が違うため）
export type PriceMap = Record<string, string>;

// 画面で扱う1行
export type VehicleRow = {
  id: string;
  seriesGroup: string;
  carName: string;
  grade: string | null;
  engine: string;
  engineFamily: string | null;
  ecuType: string | null;
  stockOutput: string | null;
  stage1Gain: string | null;
  prices: PriceMap;
  labor: string | null;
  shops: string | null;
  remote: RemoteFlags;
  notes: string | null;
  displayOrder: number;
};

export type BrandRow = {
  id: string;
  displayName: string;
  slug: string;
  namespacePrefix: string;
  seriesGroups: string[];
  columns: ColumnDefinition[];
  intro: string;
  jsonLdDescription: string;
  wordPressPageId: number | null;
  vehicleCount: number;
};

/*
 * WP取込（scripts/price-sync/import-wp.mts）の列は key=セルclass接尾辞（"cell-car" 等）・
 * type=parse時のrole（"car"/"text"/"tcu" 等）のまま保存されている。
 * 一方、アプリのUI（price-viewer / price-grid）と公開HTML生成（generate-html.ts）は
 * レガシーの key/type 名前空間（car / stockOutput / type:"price" 等）で分岐している。
 * この食い違いで「取込ブランドは価格列以外が全部 — 表示」になっていたため、
 * Json→型の唯一の入口であるここで正規化する（取込データ自体は書き換えない）。
 * cellClassSuffix / labelHtml / sortKey 等のparse拡張フィールドはspreadで温存する
 * （生成テンプレート側が参照するため落とさない）。
 */
const IMPORTED_KEY_MAP: Record<string, { key: string; type: ColumnType }> = {
  "cell-car": { key: "car", type: "text" },
  "cell-grade": { key: "grade", type: "text" },
  "cell-engine": { key: "engine", type: "text" },
  "cell-maker": { key: "maker", type: "text" },
  "cell-stock": { key: "stockOutput", type: "output" },
  "cell-stage1-gain": { key: "stage1Gain", type: "output" },
  "cell-shops": { key: "shops", type: "shops" },
  "cell-remote": { key: "remote", type: "remote" },
  "cell-ecu-tcu": { key: "ecuType", type: "ecu" },
  "cell-labor": { key: "labor", type: "labor" },
};

function normalizeImportedColumn(c: ColumnDefinition): ColumnDefinition {
  const mapped = IMPORTED_KEY_MAP[c.key];
  if (mapped) return { ...c, key: mapped.key, type: mapped.type };
  // TCUは価格列（値は prices["tcu"]）。取込roleの "tcu" のままだと価格分岐に入らない
  if ((c.type as string) === "tcu") return { ...c, type: "price" };
  return c;
}

// Json（unknown）→ 型への安全な正規化
export function toColumns(v: unknown): ColumnDefinition[] {
  if (!Array.isArray(v)) return [];
  return (v as ColumnDefinition[]).map(normalizeImportedColumn).sort((a, b) => a.order - b.order);
}
export function toPrices(v: unknown): PriceMap {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const out: PriceMap = {};
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    if (typeof val === "string") out[k] = val;
  }
  return out;
}
export function toRemote(v: unknown): RemoteFlags {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const o = v as Record<string, unknown>;
  return {
    autoTuner: !!o.autoTuner,
    powerGate3: !!o.powerGate3,
    flasher: !!o.flasher,
    atOne: !!o.atOne,
  };
}

// ── 表示順の共通ルール ──────────────────────────────
// アプリ（本店/代理店）と公開HP生成の「並び」はここだけで決める。
// displayOrder はDB上の挿入順の管理用で、表示には使わない
// （二重の並びロジックがあると「アプリとHPで並びが違う」事故が再発する）。
const displayCollator = new Intl.Collator("ja", { numeric: true, sensitivity: "base" });

/** 車種の表示順: 車名→グレードのアルファベット順（数値は数値順: 3-Series < 30-Series） */
export function sortVehiclesForDisplay<T extends { carName: string; grade: string | null }>(
  vehicles: T[],
): T[] {
  return [...vehicles].sort(
    (a, b) =>
      displayCollator.compare(a.carName, b.carName) ||
      displayCollator.compare(a.grade ?? "", b.grade ?? ""),
  );
}

/** メーカーの表示順: 表示名のアルファベット順 */
export function sortBrandsForDisplay<T extends { displayName: string }>(brands: T[]): T[] {
  return [...brands].sort((a, b) => displayCollator.compare(a.displayName, b.displayName));
}
