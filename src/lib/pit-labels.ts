// mbPIT 施工ブログ: カテゴリの表示ラベル・slug（クライアント/サーバー共用）

export const PIT_CATEGORIES = [
  "ECU",
  "COATING",
  "POLISH",
  "MAINTENANCE",
  "OTHER",
] as const;

export type PitCategoryKey = (typeof PIT_CATEGORIES)[number];

export const PIT_CATEGORY_LABELS: Record<PitCategoryKey, string> = {
  ECU: "ECUチューニング",
  COATING: "コーティング",
  POLISH: "磨き",
  MAINTENANCE: "メンテナンス",
  OTHER: "その他",
};

// API(multipart) で受け取る小文字コード（仕様: ecu | coating | polish | maintenance | other）
export const PIT_CATEGORY_CODES: Record<string, PitCategoryKey> = {
  ecu: "ECU",
  coating: "COATING",
  polish: "POLISH",
  maintenance: "MAINTENANCE",
  other: "OTHER",
};

// AI が施工slugを返せなかった場合のフォールバック（SEO用ファイル名・記事slugに使用）
export const PIT_CATEGORY_SLUGS: Record<PitCategoryKey, string> = {
  ECU: "ecu-tuning",
  COATING: "coating",
  POLISH: "polishing",
  MAINTENANCE: "maintenance",
  OTHER: "service",
};

export const PIT_STATUS_LABELS: Record<string, string> = {
  PROCESSING: "記事を作成中",
  PUBLISHED: "公開済み",
  HELD: "保留（本部確認中）",
  FAILED: "エラー",
};
