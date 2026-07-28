/*
 * mbPIT 店舗マスター: アプリのカラム ⇄ WordPress term meta のマッピング定義。
 *
 * ここが唯一のマッピング原本。UI（フォーム項目）・同期エンジン・検証・取込の
 * 全てがこのファイルを参照する。項目を追加するときはこのファイルだけ直す。
 *
 * 設計（価格同期と同思想）:
 * - アプリ（PitStore）が原本。WordPressは表示のための投影先
 * - 同期対象は STORE_META_FIELDS の9項目のみ。contactPerson / internalNote / plan は
 *   アプリ専用でWPへ絶対に送らない（このファイルに載せないことで構造的に保証）
 * - 空文字は「未設定」= WP表示側でその行ごと消える
 *
 * このファイルは純データ＋純関数のみ（クライアントの編集フォームからも参照する）。
 * ハッシュ計算・WP通信は src/server/pit/store-sync.ts 側。
 */

// PitStore の同期対象カラム名（この型に無いカラムは同期不能）
export type StoreMetaField =
  | "area"
  | "address"
  | "hours"
  | "closedDays"
  | "tel"
  | "email"
  | "website"
  | "serviceTags"
  | "intro";

export type StoreInfo = Record<StoreMetaField, string>;

export const STORE_META_FIELDS: {
  field: StoreMetaField;
  metaKey: string;
  label: string;
  maxLen: number;
  placeholder: string;
}[] = [
  { field: "area", metaKey: "mbpit_area", label: "エリア（市区町村）", maxLen: 50, placeholder: "大阪府堺市" },
  { field: "address", metaKey: "mbpit_address", label: "所在地（番地まで）", maxLen: 120, placeholder: "大阪府堺市○○区1-2-3" },
  { field: "hours", metaKey: "mbpit_hours", label: "営業時間", maxLen: 60, placeholder: "10:00〜19:00" },
  { field: "closedDays", metaKey: "mbpit_closed", label: "定休日", maxLen: 60, placeholder: "水曜・第2火曜" },
  { field: "tel", metaKey: "mbpit_tel", label: "電話番号", maxLen: 20, placeholder: "072-000-0000" },
  { field: "email", metaKey: "mbpit_email", label: "メールアドレス", maxLen: 100, placeholder: "info@example.com" },
  { field: "website", metaKey: "mbpit_website", label: "ホームページURL", maxLen: 200, placeholder: "https://example.com" },
  { field: "serviceTags", metaKey: "mbpit_tags", label: "対応内容（読点区切り）", maxLen: 100, placeholder: "チューニング、メンテナンス" },
  { field: "intro", metaKey: "mbpit_intro", label: "紹介文（1〜3文・200字目安）", maxLen: 300, placeholder: "" },
];

// 既存5店舗の確定紐付け（仕様書 §1.1。初期取込の突合に使用）
export const KNOWN_WP_STORES: {
  termId: number;
  name: string;
  categorySlug: string;
  shortSlug: string;
  pageId: number;
}[] = [
  { termId: 549, name: "On's", categorySlug: "ons-mbpit", shortSlug: "ons", pageId: 20212 },
  { termId: 547, name: "CharismGarage", categorySlug: "charism-garage", shortSlug: "charism-garage", pageId: 20211 },
  { termId: 551, name: "Anubis Garage", categorySlug: "anubis-garage", shortSlug: "anubis-garage", pageId: 20213 },
  { termId: 553, name: "プレジャー", categorySlug: "pleasure", shortSlug: "pleasure", pageId: 20214 },
  { termId: 555, name: "Glanzcoat", categorySlug: "glanzcoat-mbpit", shortSlug: "glanzcoat", pageId: 20215 },
];

/** 店舗短slug = category slug から末尾 -mbpit を除去（変更禁止の規則。パーマリンク生成と共有） */
export function shortSlugOf(categorySlug: string): string {
  return categorySlug.replace(/-mbpit$/, "");
}

/** 同期対象フィールドだけを WP meta ペイロードに変換（アプリ専用カラムは構造上含まれない） */
export function buildMetaPayload(info: StoreInfo): Record<string, string> {
  const out: Record<string, string> = {};
  for (const { field, metaKey } of STORE_META_FIELDS) out[metaKey] = info[field] ?? "";
  return out;
}

/** WP term meta → アプリのカラム値（取込用） */
export function metaToStoreInfo(meta: Record<string, unknown> | null | undefined): StoreInfo {
  const out = {} as StoreInfo;
  for (const { field, metaKey } of STORE_META_FIELDS) {
    const v = meta?.[metaKey];
    out[field] = typeof v === "string" ? v : "";
  }
  return out;
}

/** 入力バリデーション。エラーは field → メッセージ */
export function validateStoreInfo(info: StoreInfo): Partial<Record<StoreMetaField, string>> {
  const errors: Partial<Record<StoreMetaField, string>> = {};
  for (const { field, label, maxLen } of STORE_META_FIELDS) {
    const v = info[field] ?? "";
    if (/<[a-zA-Z/!]/.test(v)) errors[field] = `${label}: HTMLタグは使えません`;
    else if (v.length > maxLen) errors[field] = `${label}: ${maxLen}文字以内にしてください`;
  }
  const { website, email, tel } = info;
  if (website && !/^https?:\/\/\S+$/.test(website)) {
    errors.website = "ホームページURLは http:// または https:// で始まる形式にしてください";
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "メールアドレスの形式が正しくありません";
  }
  if (tel && !/^[0-9+\-]+$/.test(tel)) {
    errors.tel = "電話番号は数字・ハイフン・+ のみ使えます";
  }
  return errors;
}
