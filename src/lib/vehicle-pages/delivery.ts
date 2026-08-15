// 購入導線（施工方式ごとの料金）の型と計算。
// 方針: 金額は**ページ生成時にサーバー側で計算**して静的に埋め込む。
// （この環境ではページ内JSが動かないことがあるため、電卓UIに頼らない）

export type DeliveryKey = "inPerson" | "atOne" | "ixi" | "mailIn";

export type DeliveryDef = {
  key: DeliveryKey;
  ja: string;
  en: string;
  /** 端末を買い切る方式か（初回のみ端末代が乗る） */
  hasDevice: boolean;
  /** 発送が発生する方式か（送料が乗る） */
  ships: boolean;
};

export const DELIVERY_DEFS: DeliveryDef[] = [
  { key: "inPerson", ja: "ご来店（対面施工）", en: "In person (visit us)", hasDevice: false, ships: false },
  { key: "atOne", ja: "AT One（端末購入・リモート）", en: "AT One (buy device, remote)", hasDevice: true, ships: true },
  { key: "ixi", ja: "IXI Flasher（端末購入・リモート）", en: "IXI Flasher (buy device, remote)", hasDevice: true, ships: true },
  { key: "mailIn", ja: "ECU郵送（現物をお送りいただく）", en: "Mail-in ECU", hasDevice: false, ships: true },
];

export type VehicleMethods = Partial<Record<DeliveryKey, boolean>>;

export function toMethods(v: unknown): VehicleMethods {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const o = v as Record<string, unknown>;
  const out: VehicleMethods = {};
  for (const d of DELIVERY_DEFS) {
    if (typeof o[d.key] === "boolean") out[d.key] = o[d.key] as boolean;
  }
  return out;
}

export type ShopSettingLike = {
  shippingDomesticJpy: number;
  shippingOverseasJpy: unknown;
  deviceAtOneJpy: number | null;
  deviceIxiJpy: number | null;
  mailInBaseFeeJpy: number | null;
  usdRate: number | null;
  notesJa: string | null;
  notesEn: string | null;
};

export const OVERSEAS_REGIONS: { key: string; ja: string; en: string }[] = [
  { key: "asia", ja: "アジア", en: "Asia" },
  { key: "northAmerica", ja: "北米", en: "North America" },
  { key: "europe", ja: "欧州", en: "Europe" },
  { key: "oceania", ja: "オセアニア", en: "Oceania" },
  { key: "other", ja: "その他", en: "Rest of world" },
];

export function overseasShipping(v: unknown): Record<string, number> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const o = v as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const r of OVERSEAS_REGIONS) {
    const n = Number(o[r.key]);
    if (Number.isFinite(n) && n > 0) out[r.key] = Math.round(n);
  }
  return out;
}

/** 施工方式ごとの見積り1件分 */
export type DeliveryQuote = {
  key: DeliveryKey;
  labelJa: string;
  labelEn: string;
  /** 施工料（車種の基本価格）。null は要見積り */
  workJpy: number | null;
  deviceJpy: number | null;
  shippingJpy: number | null;
  extraJpy: number | null; // ECU郵送の基本工賃など
  /** 合計。要見積り要素があれば null */
  totalJpy: number | null;
  /** 端末を持っている場合の再施工価格（端末代を除いた額） */
  repeatJpy: number | null;
};

/** 円 → 表示文字列 */
export function yen(n: number): string {
  return "¥" + n.toLocaleString("ja-JP");
}

/** 円 → USD概算（レート未設定なら null） */
export function usd(n: number, rate: number | null): string | null {
  if (!rate || rate <= 0) return null;
  const v = Math.ceil(n / rate);
  return "$" + v.toLocaleString("en-US");
}

/**
 * 車両1台分の方式別見積りを作る。
 * workJpy には「Stage1などの主要価格」を渡す（呼び出し側で決める）。
 */
export function buildQuotes(args: {
  methods: VehicleMethods;
  setting: ShopSettingLike;
  workJpy: number | null;
  overseas: boolean;
  overseasRegionKey?: string;
}): DeliveryQuote[] {
  const { methods, setting, workJpy, overseas, overseasRegionKey } = args;
  const ship = overseas
    ? (overseasShipping(setting.shippingOverseasJpy)[overseasRegionKey ?? "other"] ?? null)
    : setting.shippingDomesticJpy || null;

  const out: DeliveryQuote[] = [];
  for (const d of DELIVERY_DEFS) {
    if (methods[d.key] !== true) continue;
    const deviceJpy = d.key === "atOne" ? setting.deviceAtOneJpy : d.key === "ixi" ? setting.deviceIxiJpy : null;
    const extraJpy = d.key === "mailIn" ? setting.mailInBaseFeeJpy : null;
    const shippingJpy = d.ships ? ship : null;

    const parts = [workJpy, d.hasDevice ? deviceJpy : 0, d.ships ? shippingJpy : 0, extraJpy ?? 0];
    const total = parts.every((p) => typeof p === "number") ? (parts as number[]).reduce((a, b) => a + b, 0) : null;
    const repeatParts = [workJpy, d.ships ? shippingJpy : 0, extraJpy ?? 0];
    const repeat =
      d.hasDevice && repeatParts.every((p) => typeof p === "number")
        ? (repeatParts as number[]).reduce((a, b) => a + b, 0)
        : null;

    out.push({
      key: d.key,
      labelJa: d.ja,
      labelEn: d.en,
      workJpy,
      deviceJpy: d.hasDevice ? deviceJpy : null,
      shippingJpy,
      extraJpy,
      totalJpy: total,
      repeatJpy: repeat,
    });
  }
  return out;
}

/* ───────────── オプション料金の解決 ───────────── */

export type OptionPriceSource = "priceTable" | "default" | "override" | "none";

export type ResolvedOptionPrice = {
  key: string;
  labelJa: string;
  labelEn: string;
  jpy: number | null; // null = 料金未設定（施工料に含む、または要見積り）
  source: OptionPriceSource;
};

/**
 * オプション1件の料金を決める。優先順位:
 *   1. 車両ごとの上書き（optionPrices）
 *   2. 価格表の列（derivedFrom がある場合。ASK・空欄・「—」は料金なし扱い）
 *   3. 語彙マスタの既定料金（priceJpy）
 */
export function resolveOptionPrice(args: {
  key: string;
  labelJa: string;
  labelEn: string;
  derivedFrom?: string;
  defaultJpy?: number | null;
  overrideJpy?: number | null;
  priceCell?: string; // derivedFrom で指す価格列の、その車両の値
}): ResolvedOptionPrice {
  const { key, labelJa, labelEn, derivedFrom, defaultJpy, overrideJpy, priceCell } = args;
  if (typeof overrideJpy === "number" && overrideJpy > 0) {
    return { key, labelJa, labelEn, jpy: overrideJpy, source: "override" };
  }
  if (derivedFrom && priceCell) {
    const n = Number(priceCell.replace(/[^0-9]/g, ""));
    if (Number.isFinite(n) && n > 0) return { key, labelJa, labelEn, jpy: n, source: "priceTable" };
  }
  if (typeof defaultJpy === "number" && defaultJpy > 0) {
    return { key, labelJa, labelEn, jpy: defaultJpy, source: "default" };
  }
  return { key, labelJa, labelEn, jpy: null, source: "none" };
}

export function toOptionPrices(v: unknown): Record<string, number> {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const o = v as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const [k, val] of Object.entries(o)) {
    const n = Number(val);
    if (Number.isFinite(n) && n > 0) out[k] = Math.round(n);
  }
  return out;
}
