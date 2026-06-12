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

// 施工内容の人間可読ラベル（専門情報なし）。
// 例: ("Stage1", true, ["O2"]) → "Stage1・バブリング・O2" / ("", false, []) → "チューニングなし"
export function tuningContentLabel(
  stage: string | null | undefined,
  pops: boolean,
  optionTags: string[] = [],
): string {
  // オプションは正規順（アルファベット）に揃えて、ラベル比較が一致するようにする
  const tags = [...optionTags].sort();
  return [(stage ?? "").trim() || "チューニングなし", pops ? "バブリング" : null, ...tags]
    .filter(Boolean)
    .join("・");
}
