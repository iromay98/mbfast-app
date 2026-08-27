// 車両バリアント個別ページの共有型。
// 生成器（generate-html.ts）は DB に依存しない純関数にするため、
// スクリプト側で PriceVehicle + VehiclePage をこの形に解決してから渡す。

import type { RemoteFlags } from "../prices/types";

export type { VehicleOptions } from "./options"; // 語彙の単一の正は DB(VehiclePageOption)
import type { OptionDef, VehicleOptions } from "./options";

export type RelatedPost = { id?: number; title: string; url: string };

/** 価格列（表示順・ラベルは PriceBrand.columns の type=price から解決） */
export type PriceItem = { key: string; label: string; value: string };

export type VehiclePageData = {
  slug: string;
  brandDisplayName: string; // 表示名（日本語のことがある: "メルセデス・ベンツ"）
  brandNameEn: string; // 英語名 "Mercedes-Benz"（ENページ・欧文キッカー用）
  brandSlug: string; // "mercedes"
  carName: string; // "C(W204)"
  grade: string | null; // "C63AMG"
  engine: string; // "M156"
  ecuType: string | null;
  stockOutput: string | null; // "457ps/600Nm"
  stage1Gain: string | null; // "+53ps/50Nm"
  prices: PriceItem[]; // JP価格（値は "143000" / "ASK" / ""）
  labor: string | null;
  remote: RemoteFlags;
  notes: string | null;
  options: VehicleOptions;
  optionDefs: OptionDef[]; // 表示順・ラベルの語彙（DBから解決したもの）
  related: RelatedPost[];
  /** EN: quote=価格非表示（既定）。price=EN価格を表示（market=EN のレコードから解決済みの値） */
  en: { mode: "quote" } | { mode: "price"; prices: PriceItem[] };
  /** 2件以上でグレードタブ表示(CSSのみ)。未設定/1件は従来の単独表示 */
  variants?: VehicleVariant[];
  /** 単独ページ用の購入データ(統合ページはvariants[].purchaseを使う) */
  purchase?: PurchaseData;
};

/** 見積りシミュレーター+決済用の購入データ(JPのみ)。価格は全て静的にHTMLへ出す */
export type PurchaseMenu = { key: string; label: string; jpy: number; variationId: number | null };
export type PurchaseOption = { key: string; label: string; jpy: number; productId: number | null };
export type PurchaseData = {
  menus: PurchaseMenu[]; // 択一の施工メニュー(ラジオ)
  addons: PurchaseMenu[]; // 車両ごと価格のオプション(チェックボックス)。TCU等。決済はバリエーションで行う
  options: PurchaseOption[]; // 全車共通の固定価格オプション
};

/** グレード統合ページの1バリエーション(タブ1枚分)。先頭が代表＝初期表示 */
export type VehicleVariant = {
  label: string; // タブ見出し("C63AMG 457ps" 等)
  grade: string | null;
  engine: string;
  ecuType: string | null;
  stockOutput: string | null;
  stage1Gain: string | null;
  prices: PriceItem[];
  enPrices: PriceItem[] | null; // ENで価格表示するときのみ
  purchase?: PurchaseData; // JPの見積りシミュレーター用
};

export type GeneratedPage = { title: string; html: string };
