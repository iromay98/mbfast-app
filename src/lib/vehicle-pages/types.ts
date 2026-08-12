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
};

export type GeneratedPage = { title: string; html: string };
