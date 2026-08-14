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

import { isInJapan, isShortMapUrl, parseLatLng } from "@/lib/geo/gmap";

// PitStore の同期対象カラム名（この型に無いカラムは同期不能）
export type StoreMetaField =
  | "area"
  | "address"
  | "hours"
  | "closedDays"
  | "tel"
  | "email"
  | "website"
  | "lineUrl"
  | "serviceTags"
  | "intro"
  | "mapUrl"
  | "lat"
  | "lng";

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
  // 公式LINE。値が入るとHP（店舗ページ）に「LINEで問い合わせ」ボタンが出る（WP側テンプレートが mbpit_line を参照）
  { field: "lineUrl", metaKey: "mbpit_line", label: "公式LINE URL", maxLen: 200, placeholder: "https://lin.ee/xxxxx" },
  { field: "serviceTags", metaKey: "mbpit_tags", label: "対応内容（読点区切り）", maxLen: 100, placeholder: "チューニング、メンテナンス" },
  { field: "intro", metaKey: "mbpit_intro", label: "紹介文（1〜3文・200字目安）", maxLen: 300, placeholder: "" },
  // 地図: 店舗はGoogleマップの共有URLを貼るだけ。lat/lngは保存時に自動で埋まる（読み取り専用扱い）
  {
    field: "mapUrl",
    metaKey: "mbpit_map",
    label: "GoogleマップURL（貼るだけで座標を取得）",
    maxLen: 500,
    placeholder: "https://maps.app.goo.gl/… または https://www.google.com/maps/place/…",
  },
  { field: "lat", metaKey: "mbpit_lat", label: "緯度（自動取得）", maxLen: 20, placeholder: "35.659500" },
  { field: "lng", metaKey: "mbpit_lng", label: "経度（自動取得）", maxLen: 20, placeholder: "139.700500" },
];

/** 画面上で店舗が直接編集しない項目（値は mapUrl から自動で入る） */
export const DERIVED_FIELDS: StoreMetaField[] = ["lat", "lng"];

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
  const { website, email, tel, lineUrl } = info;
  if (website && !/^https?:\/\/\S+$/.test(website)) {
    errors.website = "ホームページURLは http:// または https:// で始まる形式にしてください";
  }
  // LINEの公式リンクだけを受け付ける（HP側で「LINEで問い合わせ」ボタンになるため、別サービスのURLを弾く）
  if (lineUrl && !/^https:\/\/(lin\.ee|(?:[a-z0-9-]+\.)?line\.me)\/\S+$/.test(lineUrl)) {
    errors.lineUrl = "公式LINEのURL（https://lin.ee/… または https://line.me/…）を入力してください";
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "メールアドレスの形式が正しくありません";
  }
  if (tel && !/^[0-9+\-]+$/.test(tel)) {
    errors.tel = "電話番号は数字・ハイフン・+ のみ使えます";
  }
  const { mapUrl, lat, lng } = info;
  if (mapUrl) {
    if (!/^https?:\/\/\S+$/.test(mapUrl)) {
      errors.mapUrl = "GoogleマップのURLを貼り付けてください";
    } else if (!/(^https?:\/\/(?:[a-z0-9-]+\.)*google\.[a-z.]+\/maps)|(^https:\/\/maps\.app\.goo\.gl\/)|(^https:\/\/goo\.gl\/maps\/)/.test(mapUrl)) {
      errors.mapUrl = "GoogleマップのURLのみ登録できます";
    } else if (!isShortMapUrl(mapUrl) && !parseLatLng(mapUrl)) {
      // 短縮URLはサーバー側で展開してから座標を取るのでここでは通す
      errors.mapUrl = "このURLからは座標を取得できません。地図上で店舗を選んでから共有URLをコピーしてください";
    }
  }
  // lat/lng は mapUrl から自動で入るが、手で直した場合に備えて確かめる
  if (lat || lng) {
    if (!lat || !lng) {
      errors[lat ? "lng" : "lat"] = "緯度と経度は両方必要です";
    } else if (!/^-?\d+(\.\d+)?$/.test(lat) || !/^-?\d+(\.\d+)?$/.test(lng)) {
      errors.lat = "緯度・経度は数値で入力してください";
    } else if (!isInJapan({ lat: Number(lat), lng: Number(lng) })) {
      errors.lat = "座標が日本の範囲外です。緯度と経度が入れ替わっていないか確認してください";
    }
  }
  return errors;
}
