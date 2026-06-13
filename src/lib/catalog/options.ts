/*
 * 燃料(ガソリン/ディーゼル)に応じた構造化オプションタグ／バブリング可否。
 * - 全車共通: NOx, DTC, O2
 * - ディーゼルのみ: Adblue, DPF, EGR（ガソリンでは非表示）
 * - バブリング(Pops): ガソリン/不明は可、ディーゼルは不可
 * - Hardcut は現状不要のため廃止
 */

export type FuelKind = "gasoline" | "diesel" | "unknown";

export function fuelKindOf(fuel?: string | null): FuelKind {
  const f = (fuel ?? "").toLowerCase();
  if (/diesel|軽油|gasoil|gazole/.test(f)) return "diesel";
  if (/petrol|gasoline|benzin|ガソリン/.test(f)) return "gasoline";
  return "unknown";
}

const BASE_TAGS = ["NOx", "DTC", "O2"];
const DIESEL_TAGS = ["Adblue", "DPF", "EGR"];

// その燃料で選択肢として出すタグ
export function optionTagsFor(kind: FuelKind): string[] {
  // ガソリンは Adblue/DPF/EGR を出さない。ディーゼル/不明は全部出す。
  return kind === "gasoline" ? BASE_TAGS : [...BASE_TAGS, ...DIESEL_TAGS];
}

// バブリング(Pops)を扱えるか（ディーゼルは不可）
export function popsAllowed(kind: FuelKind): boolean {
  return kind !== "diesel";
}

// ステージ並び順: チューニングなし(空)→Stage1→Stage1.5→Stage2…→その他。小数も解釈。
export function stageRank(stage: string): number {
  if (!stage.trim()) return -1;
  const m = stage.match(/(\d+(?:\.\d+)?)/);
  return m ? parseFloat(m[1]) : 999;
}

// 既定で選べるステージ（カタログに無くても選択/リクエスト可能）。
// ベンツ(Mercedes/AMG)は Stage1.5 も用意する。
export function baselineStages(manufacturer?: string | null): string[] {
  const isMercedes = /mercedes|benz|メルセデス|ベンツ|\bamg\b/i.test(manufacturer ?? "");
  return isMercedes ? ["", "Stage1", "Stage1.5", "Stage2"] : ["", "Stage1", "Stage2"];
}

// バブリングの表示ラベル。なし→null / 全モード→"バブリング(全モード)" / スポーツ→"バブリング(スポーツ)"。
export function popsModeLabel(pops: boolean, popsSport = false): string | null {
  if (!pops) return null;
  return popsSport ? "バブリング(スポーツ)" : "バブリング(全モード)";
}

// 施工内容の人間可読ラベル（専門情報なし）。popsSport: true=スポーツ / false=全モード。
// 例: ("Stage1", true, ["O2"], false) → "Stage1・バブリング(全モード)・O2"
export function tuningContentLabel(
  stage: string | null | undefined,
  pops: boolean,
  optionTags: string[] = [],
  popsSport = false,
): string {
  // オプションは正規順（アルファベット）に揃えて、ラベル比較が一致するようにする
  const tags = [...optionTags].sort();
  return [(stage ?? "").trim() || "チューニングなし", popsModeLabel(pops, popsSport), ...tags]
    .filter(Boolean)
    .join("・");
}
