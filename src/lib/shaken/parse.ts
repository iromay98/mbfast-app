/*
 * 電子車検証 二次元コード パーサ（DOM 非依存・サーバ/クライアント共用）
 *
 * 仕様: 国土交通省「二次元コード記載項目一覧」2023.1版。
 *  - 区切り文字: "/"（半角スラッシュ）
 *  - エンコード: Shift_JIS（呼び出し側で復号済みの文字列を渡す前提）
 *  - 二次元コード2（6項目）: バージョン / 登録番号(全角12) / 標板区分 / 車台番号 / 原動機型式 / 帳票種別
 *  - 二次元コード3（21項目）: バージョン / 車台番号打刻位置 / 型式指定番号・類別区分番号 /
 *      有効期限(券面=999999) / 有効期限(閲覧) / 有効期限(記録事項) / 初度登録年月(YYMM) / 型式 /
 *      軸重×4 / 騒音規制 / 近接排気騒音 / 駆動方式 / オパシメータ / NOx・PMモード / NOx値 / PM値 /
 *      保安基準適用年月日 / 燃料の種類コード(2)
 */

export type ShakenVehicleInfo = {
  vin?: string; // 車台番号
  registrationNumber?: string; // 自動車登録番号・車両番号（ナンバー）
  engineModelCode?: string; // 原動機型式
  vehicleModelCode?: string; // 型式
  modelDesignationNumber?: string; // 型式指定番号・類別区分番号
  firstRegistration?: string; // 初度登録年月（YYYY-MM）
  carYear?: number; // 初度登録の西暦年
  inspectionExpiry?: string; // 有効期間満了日（YYYY-MM-DD）
  fuel?: string; // 燃料の種類（ラベル）
};

export type ShakenRaw = { code2?: string; code3?: string };

const DELIM = "/";

/** 燃料の種類コード（別紙2 #21） */
const FUEL_LABELS: Record<string, string> = {
  "01": "ガソリン",
  "02": "軽油",
  "03": "LPG",
  "04": "灯油",
  "05": "電気",
  "06": "ガソリン・LPG",
  "07": "ガソリン・灯油",
  "08": "メタノール",
  "09": "CNG",
  "11": "LNG",
  "12": "ANG",
  "13": "圧縮水素",
  "14": "ガソリン・電気",
  "15": "LPG・電気",
  "16": "軽油・電気",
  "99": "その他",
};

/** 全角英数字(U+FF01–FF5E)→半角、全角ブランク(U+3000)→半角スペースへ変換 */
function toHalfWidth(s: string): string {
  return s
    .replace(/[！-～]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, " ");
}

/** 空・パディングのみ（半角/全角ブランク、ハイフン類のみ）を空とみなして整形 */
function clean(s: string | undefined): string | undefined {
  if (s == null) return undefined;
  const t = s.replace(/　/g, " ").trim();
  if (t === "" || /^[-ー－]+$/.test(t)) return undefined;
  return t;
}

/**
 * 登録番号（全角12: 標板文字4 + 分類番号3 + カナ1 + 一連番号4）を読みやすい1行へ。
 * 例: "品川△△５５△や△△９９" -> "品川 55 や 99"
 * 桁数が想定外の場合は全角ブランクを除去した素の値を返す。
 */
export function normalizeRegistration(raw: string | undefined): string | undefined {
  if (raw == null) return undefined;
  // 全角ブランクのみを境界整形に使うため、ここでは trim しない
  const s = raw.replace(/\s+$/u, "");
  if (s.replace(/[　\s]/g, "") === "") return undefined;

  if (s.length >= 12) {
    const place = toHalfWidth(s.slice(0, 4)).trim();
    const classNo = toHalfWidth(s.slice(4, 7)).replace(/\s+/g, "");
    const kana = s.slice(7, 8).replace(/　/g, "").trim();
    const serial = toHalfWidth(s.slice(8, 12)).replace(/\s+/g, "");
    const out = [place, classNo, kana, serial].filter((p) => p !== "").join(" ");
    return out || undefined;
  }
  // フォールバック: 全角ブランク除去
  const fallback = toHalfWidth(s).replace(/\s+/g, " ").trim();
  return fallback || undefined;
}

/** 型式・原動機型式の特殊値を整形。不明系は undefined を返す。 */
export function cleanModelCode(raw: string | undefined): string | undefined {
  const t = clean(raw);
  if (!t) return undefined;
  switch (t) {
    case "*FUMEI":
      return undefined; // 型式IDコード不明
    case "*KUMITATE":
      return "組立";
    case "*SHISAKU":
      return "試作";
  }
  // 改造(*K)・試作(*S)の接尾は除去して基底型式を残す
  return t.replace(/\*[KS]$/, "").trim() || undefined;
}

/**
 * YY を西暦へ（初度登録年月の世紀補正）。ECU 施工対象車は実質 2000 年以降のため、
 * YY<=50 を 20xx、51-99 を 19xx とする（1950 年以前の車は対象外と割り切る）。
 */
function yyToYear(yy: number): number {
  return yy <= 50 ? 2000 + yy : 1900 + yy;
}

/** 初度登録年月 YYMM -> { ym: "YYYY-MM", year } 。"9999"/不正は undefined。 */
export function parseFirstRegistration(
  raw: string | undefined,
): { ym: string; year: number } | undefined {
  const t = clean(raw);
  if (!t || t === "9999" || !/^\d{4}$/.test(t)) return undefined;
  const yy = Number(t.slice(0, 2));
  const mm = Number(t.slice(2, 4));
  if (mm < 1 || mm > 12) return undefined;
  const year = yyToYear(yy);
  return { ym: `${year}-${String(mm).padStart(2, "0")}`, year };
}

/** 有効期間満了日 YYMMDD -> "YYYY-MM-DD"。"999999"/不正は undefined（電子車検証券面は固定999999）。 */
export function parseExpiry(raw: string | undefined): string | undefined {
  const t = clean(raw);
  if (!t || t === "999999" || !/^\d{6}$/.test(t)) return undefined;
  const yy = Number(t.slice(0, 2));
  const mm = Number(t.slice(2, 4));
  const dd = Number(t.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return undefined;
  // 有効期間満了日は将来日のため常に 2000 年代として扱う
  const year = 2000 + yy;
  return `${year}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

/** "/"区切りの項目数で二次元コード2/3を判別 */
export function classifyCode(raw: string): "code2" | "code3" | "unknown" {
  const n = raw.split(DELIM).length;
  if (n === 6) return "code2";
  if (n === 21) return "code3";
  return "unknown";
}

/** 二次元コード2（6項目）を解析 */
export function parseCode2(raw: string): Partial<ShakenVehicleInfo> {
  const p = raw.split(DELIM);
  if (p.length < 6) return {};
  return {
    registrationNumber: normalizeRegistration(p[1]),
    vin: clean(p[3]), // 職権打刻 [41]12345 もそのまま保持
    engineModelCode: cleanModelCode(p[4]),
  };
}

/** 二次元コード3（21項目）を解析 */
export function parseCode3(raw: string): Partial<ShakenVehicleInfo> {
  const p = raw.split(DELIM);
  if (p.length < 21) return {};
  const out: Partial<ShakenVehicleInfo> = {
    modelDesignationNumber: clean(p[2]),
    vehicleModelCode: cleanModelCode(p[7]),
  };
  // 有効期限: 券面(#3) / 閲覧(#4) / 記録事項(#5) のうち実値を採用
  const expiry = parseExpiry(p[3]) ?? parseExpiry(p[4]) ?? parseExpiry(p[5]);
  if (expiry) out.inspectionExpiry = expiry;
  // 初度登録年月
  const reg = parseFirstRegistration(p[6]);
  if (reg) {
    out.firstRegistration = reg.ym;
    out.carYear = reg.year;
  }
  // 燃料種類
  const fuelCode = clean(p[20]);
  if (fuelCode && FUEL_LABELS[fuelCode]) out.fuel = FUEL_LABELS[fuelCode];
  return out;
}

/** 任意の生コード文字列（コード2/3いずれか）を判別して解析 */
export function parseAny(raw: string): Partial<ShakenVehicleInfo> {
  switch (classifyCode(raw)) {
    case "code2":
      return parseCode2(raw);
    case "code3":
      return parseCode3(raw);
    default:
      return {};
  }
}

/** コード2/3の解析結果を統合（後勝ちにせず、値のある側を優先） */
export function mergeShaken(...parts: Array<Partial<ShakenVehicleInfo>>): ShakenVehicleInfo {
  const out: ShakenVehicleInfo = {};
  for (const part of parts) {
    for (const [k, v] of Object.entries(part)) {
      if (v === undefined || v === null || v === "") continue;
      if ((out as Record<string, unknown>)[k] == null) {
        (out as Record<string, unknown>)[k] = v;
      }
    }
  }
  return out;
}

/** raw {code2, code3} から統合済みの車両情報を得る（mergeShaken のショートカット） */
export function parseShakenRaw(raw: ShakenRaw): ShakenVehicleInfo {
  return mergeShaken(
    raw.code2 ? parseCode2(raw.code2) : {},
    raw.code3 ? parseCode3(raw.code3) : {},
  );
}
