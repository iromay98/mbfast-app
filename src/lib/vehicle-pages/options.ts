// 車両ページ「対応オプション」の**単一の正**（mbpit-genres.json と同じ思想）。
// 新しいオプションを増やすときは、ここに1行足す→デプロイするだけ。
// 生成器（generate-html.ts）・CLI（vpages-set.mts）・管理画面（/hq/vehicle-pages）は
// 全部この配列を読むので、他のファイルの変更は不要。

export type OptionDef = { key: string; jp: string; en: string; short?: string };

export const OPTION_DEFS: OptionDef[] = [
  { key: "babble", jp: "バブリング（ポップス＆バングス）", en: "Pops and Bangs (Burble)" },
  { key: "dragonAfterfire", jp: "ドラゴンアフターファイヤ", en: "Dragon Afterfire", short: "ドラゴン" },
  { key: "coldStartOff", jp: "コールドスタートオフ", en: "Cold Start Off", short: "冷始OFF" },
  { key: "idlingStopOff", jp: "アイドリングストップ解除", en: "Auto Start-Stop Off", short: "アイスト" },
  { key: "mapSwitch", jp: "マップスイッチ", en: "Map Switch", short: "MapSW" },
  { key: "ecuUnlock", jp: "ECUアンロック（要ベンチ作業）", en: "ECU Unlock (bench required)", short: "解錠要" },
  { key: "limiterCut", jp: "スピードリミッター解除", en: "Speed Limiter Removal" },
  { key: "tcu", jp: "TCUチューニング", en: "TCU Tuning" },
];

export const OPTION_KEYS = OPTION_DEFS.map((o) => o.key);

/** 車両ごとの○×。キーは OPTION_DEFS のもののみ有効（未知キーは無視される） */
export type VehicleOptions = Record<string, boolean>;

/** Json(unknown) → VehicleOptions の安全な正規化。未知キー・非booleanは落とす */
export function toOptions(v: unknown): VehicleOptions {
  if (!v || typeof v !== "object" || Array.isArray(v)) return {};
  const o = v as Record<string, unknown>;
  const out: VehicleOptions = {};
  for (const key of OPTION_KEYS) {
    if (typeof o[key] === "boolean") out[key] = o[key] as boolean;
  }
  return out;
}
