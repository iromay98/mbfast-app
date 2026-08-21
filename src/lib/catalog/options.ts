/*
 * 燃料(ガソリン/ディーゼル)に応じた構造化オプションタグ／バブリング可否。
 * - 全車共通: NOx, DTC, O2
 * - ディーゼルのみ: Adblue, DPF, EGR（ガソリンでは非表示）
 * - バブリング(Pops): ガソリン/不明は可、ディーゼルは不可
 * - Hardcut は現状不要のため廃止
 */

export type FuelKind = "gasoline" | "diesel" | "unknown";

/*
 * 対象ユニット。TCU（ミッション）はエンジン側の選択肢（バブリング・O2/NOx/DTC・
 * Adblue/DPF/EGR・スピードリミッターカット・アイドリングストップ等）が一切関係ないため、
 * バリエーションは Stage1 の1本だけにする（2026-08-13 本店判断）。
 * 判定は unitOf() に通してから使う（DBは文字列で "ECU" | "TCU"）。
 */
export type UnitKind = "ECU" | "TCU";

export function unitOf(unit?: string | null): UnitKind {
  return (unit ?? "").trim().toUpperCase() === "TCU" ? "TCU" : "ECU";
}

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

/*
 * メーカー固有オプション（2026-08 追加）。
 * アイドリングストップ解除・コールドスタートオフは、本店が対応しているメーカーだけに出す
 * （どの車でも出すと「選べるのに作れない」依頼が来るため）。
 * 対応メーカーを増やすときは MAKER_OPTION_TAGS に足すだけでよい
 * ＝UI（代理店コンフィギュレータ・本店カタログ）とサーバー側の許可判定は
 * すべて optionTagsFor を通るので、ここ1箇所で揃う。
 */
export const IDLING_STOP_TAG = "アイドリングストップ解除";
export const COLD_START_OFF_TAG = "コールドスタートオフ";

const MAKER_OPTION_TAGS: { re: RegExp; not?: RegExp; tags: string[] }[] = [
  // BMW / Audi / Porsche / Volkswagen（本店確認済み・2026-08-13）
  { re: /\bbmw\b|ビー?エム/i, tags: [IDLING_STOP_TAG, COLD_START_OFF_TAG] },
  { re: /\baudi\b|アウディ/i, tags: [IDLING_STOP_TAG, COLD_START_OFF_TAG] },
  { re: /porsche|ポルシェ/i, tags: [IDLING_STOP_TAG, COLD_START_OFF_TAG] },
  { re: /volkswagen|\bvw\b|フォルクスワーゲン/i, tags: [IDLING_STOP_TAG, COLD_START_OFF_TAG] },
  /*
   * 車名がBMWでなくても中身がBMWのエンジンなら同じOPが作れる（2026-08-19 追加）。
   * A90/A91スープラ＝B58/B48（BMW製）。トヨタ名義なのでメーカー名だけでは拾えないため
   * **車種名・世代も突き合わせる**（下の buildHaystack）。
   * 旧型スープラ（A80の2JZ・A70の7M）はBMWではないので not で除外する。
   */
  {
    re: /supra|スープラ/i,
    not: /\ba(?:70|80)\b|jza|ma70|2jz|1jz|\b7m\b/i,
    tags: [IDLING_STOP_TAG, COLD_START_OFF_TAG],
  },
];

/*
 * 車両の識別情報。BaseFile / ServiceRecord の行をそのまま渡せる形にしてある
 * ＝判定に使う項目が増えても呼び出し側を直さなくてよい（メーカー名だけでは
 * A90スープラのような「他社名義のBMWエンジン」を拾えないため、車種名も見る）。
 */
export type VehicleOptionContext = {
  manufacturer?: string | null;
  /** 車種名（"スープラ(A90) RZ" のように型式込みでよい） */
  model?: string | null;
  /** 世代・型式（model に型式が入っていない登録の取りこぼしを防ぐ） */
  generation?: string | null;
  /** "ECU" | "TCU"。TCUはエンジン側OPを一切出さない */
  unit?: string | null;
};

/** メーカー名・車種名・世代をひとつなぎにして突き合わせる（表記ゆれを吸収するため） */
function buildHaystack(v: VehicleOptionContext): string {
  return [v.manufacturer, v.model, v.generation]
    .map((x) => (x ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

/** その車で追加で選べるオプション（該当なしは空配列） */
export function makerOptionTags(v: VehicleOptionContext): string[] {
  const hay = buildHaystack(v);
  if (!hay) return [];
  const out: string[] = [];
  for (const { re, not, tags } of MAKER_OPTION_TAGS) {
    if (!re.test(hay)) continue;
    if (not?.test(hay)) continue;
    for (const t of tags) if (!out.includes(t)) out.push(t);
  }
  return out;
}

// その燃料・メーカーで選択肢として出すタグ。
// スピードリミッターカットは全車種で表示し、可否は各Calの limiterCutDisabled で制御する。
// TCU（ミッション）はエンジン側のオプションが関係しないため**1つも出さない**。
export function optionTagsFor(kind: FuelKind, vehicle: VehicleOptionContext = {}): string[] {
  if (unitOf(vehicle.unit) === "TCU") return [];
  // ガソリンは Adblue/DPF/EGR を出さない。ディーゼル/不明は全部出す。
  const base = kind === "gasoline" ? [...BASE_TAGS] : [...BASE_TAGS, ...DIESEL_TAGS];
  // バブリング強はバブリング可の燃料のみ（ディーゼルは不可）
  if (popsAllowed(kind)) base.push(POPS_STRONG_TAG);
  base.push(SPEED_LIMITER_TAG);
  // メーカー固有（アイドリングストップ解除・コールドスタートオフ等）
  for (const t of makerOptionTags(vehicle)) if (!base.includes(t)) base.push(t);
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

// バブリング(Pops)を扱えるか（ディーゼルは不可。TCUはエンジン側の話なので不可）
export function popsAllowed(kind: FuelKind, unit?: string | null): boolean {
  if (unitOf(unit) === "TCU") return false;
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
// TCU（ミッション）は段階分けをしないので Stage1 の1本だけ（「チューニングなし」も出さない
// ＝TCUファイル自体がチューニング内容のため、無しという構成が存在しない）。
export function baselineStages(vehicle: VehicleOptionContext = {}): string[] {
  if (unitOf(vehicle.unit) === "TCU") return ["Stage1"];
  const isMercedes = /mercedes|benz|メルセデス|ベンツ|\bamg\b/i.test(vehicle.manufacturer ?? "");
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
