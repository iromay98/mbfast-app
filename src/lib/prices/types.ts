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

// Json（unknown）→ 型への安全な正規化
export function toColumns(v: unknown): ColumnDefinition[] {
  if (!Array.isArray(v)) return [];
  return (v as ColumnDefinition[]).slice().sort((a, b) => a.order - b.order);
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
