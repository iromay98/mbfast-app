// 車両ページ「対応オプション」の語彙。**単一の正は DB の VehiclePageOption テーブル**で、
// 管理画面（/hq/prices のブランド設定内）から追加・並べ替え・無効化できる。
// ここにあるのは型と、DB読み取り不能時に使うフォールバック定義のみ。

export type OptionDef = {
  key: string;
  jp: string;
  en: string;
  short?: string;
  /** 価格列key。その列に値があれば〇と自動判定（手動設定が優先） */
  derivedFrom?: string;
};

/** DBが空/未マイグレーションのときのフォールバック（migrationの初期投入と同一） */
export const FALLBACK_OPTION_DEFS: OptionDef[] = [
  { key: "babble", jp: "バブリング（ポップス＆バングス）", en: "Pops and Bangs (Burble)", short: "バブ", derivedFrom: "babble" },
  { key: "dragonAfterfire", jp: "ドラゴンアフターファイヤ", en: "Dragon Afterfire", short: "ドラゴン" },
  { key: "coldStartOff", jp: "コールドスタートオフ", en: "Cold Start Off", short: "冷始OFF" },
  { key: "idlingStopOff", jp: "アイドリングストップ解除", en: "Auto Start-Stop Off", short: "アイスト" },
  { key: "mapSwitch", jp: "マップスイッチ", en: "Map Switch", short: "MapSW" },
  { key: "ecuUnlock", jp: "ECUアンロック（要ベンチ作業）", en: "ECU Unlock (bench required)", short: "解錠要" },
  { key: "limiterCut", jp: "スピードリミッター解除", en: "Speed Limiter Removal", short: "リミッタ", derivedFrom: "limiterCut" },
  { key: "tcu", jp: "TCUチューニング", en: "TCU Tuning", short: "TCU", derivedFrom: "tcu" },
];

/** 車両ごとの○×。キーは OptionDef.key */
export type VehicleOptions = Record<string, boolean>;

/** Json(unknown) → VehicleOptions。boolean以外は落とす（未知キーは残す＝語彙削除しても値は保持） */
export function toOptions(v: unknown): VehicleOptions {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const o = v as Record<string, unknown>;
  const out: VehicleOptions = {};
  for (const [k, val] of Object.entries(o)) {
    if (typeof val === "boolean") out[k] = val;
  }
  return out;
}

/** 新規keyの候補生成（日本語ラベル → ローマ字化はしないので、英語ラベルから作る） */
export function suggestOptionKey(labelEn: string): string {
  const words = labelEn
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
  if (words.length === 0) return "";
  return words[0] + words.slice(1).map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join("");
}
