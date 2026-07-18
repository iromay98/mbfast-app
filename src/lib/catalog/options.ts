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

const BASE_TAGS = ["NOx", "DTC", "O2", "Flap Open"];
const DIESEL_TAGS = ["Adblue", "DPF", "EGR"];

export const SPEED_LIMITER_TAG = "スピードリミッターカット";
// バブリングの強度区分。無印＝推奨 / このタグ付き＝強（触媒を無視）。
// 料金上はバブリングの一部＝無料（有料OPには数えない）。
export const POPS_STRONG_TAG = "バブリング強(触媒無視)";

// その燃料で選択肢として出すタグ。
// スピードリミッターカットは全車種で表示し、可否は各Calの limiterCutDisabled で制御する。
// （manufacturer は将来のメーカー固有OP用に残置）
export function optionTagsFor(kind: FuelKind, _manufacturer?: string | null): string[] {
  // ガソリンは Adblue/DPF/EGR を出さない。ディーゼル/不明は全部出す。
  const base = kind === "gasoline" ? [...BASE_TAGS] : [...BASE_TAGS, ...DIESEL_TAGS];
  // バブリング強はバブリング可の燃料のみ（ディーゼルは不可）
  if (popsAllowed(kind)) base.push(POPS_STRONG_TAG);
  base.push(SPEED_LIMITER_TAG);
  return base;
}

// 有料OPの数え方: バブリング強はバブリングの一部なので有料OPから除外する。
export function paidTags(tags: string[]): string[] {
  return tags.filter((t) => t !== POPS_STRONG_TAG);
}

// バブリング強はバブリング選択時のみ意味を持つ。UI・サーバー両方でこの正規化を通し、
// バブリング無しの構成に「強」タグだけが付く矛盾を防ぐ。
export function stripPopsStrongIfNoPops(tags: string[], pops: boolean): string[] {
  return pops ? tags : tags.filter((t) => t !== POPS_STRONG_TAG);
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

// tuningContentLabel の逆パース（納品→バリエーション自動登録用）。
// 形式: "stage・バブリング(全モード|スポーツ)?・tag1・tag2…"（tagsはソート済み・「・」を含まない前提）
export function parseTuningContentLabel(label: string): {
  stage: string;
  pops: boolean;
  popsSport: boolean;
  optionTags: string[];
} | null {
  const segs = label.split("・").map((s) => s.trim()).filter(Boolean);
  if (segs.length === 0) return null;
  const stage = segs[0] === "チューニングなし" ? "" : segs[0];
  let i = 1;
  let pops = false;
  let popsSport = false;
  if (segs[i] === "バブリング(全モード)") {
    pops = true;
    i++;
  } else if (segs[i] === "バブリング(スポーツ)") {
    pops = true;
    popsSport = true;
    i++;
  }
  return { stage, pops, popsSport, optionTags: segs.slice(i) };
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
