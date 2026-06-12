// enum 値 → 日本語表示ラベルのマッピング（UI 層で日本語化）

export const workTypeLabels = {
  TUNING: "チューニング",
  POPS_AND_BANGS: "バブリング",
  TCU: "TCU",
  OTHER: "その他",
} as const;

export const requestStatusLabels = {
  RECEIVED: "受付",
  IN_PROGRESS: "作業中",
  DELIVERED: "納品",
  CANCELLED: "キャンセル",
} as const;

export const requestStatusColors = {
  RECEIVED: "blue",
  IN_PROGRESS: "gold",
  DELIVERED: "green",
  CANCELLED: "gray",
} as const;

export const recordStatusLabels = {
  UPLOADED: "解析中",
  DECRYPTING: "解析中",
  DECODED: "解析済み",
  FAILED: "失敗",
} as const;

export const recordStatusColors = {
  UPLOADED: "gray",
  DECRYPTING: "gold",
  DECODED: "green",
  FAILED: "red",
} as const;

// 復号が進行中（一覧の自動更新ポーリング対象）
export const isPendingStatus = (s: string) => s === "UPLOADED" || s === "DECRYPTING";

export const announcementCategoryLabels = {
  NOTICE: "お知らせ",
  TECH: "技術情報",
  PRICING: "価格改定",
} as const;

export const announcementCategoryColors = {
  NOTICE: "blue",
  TECH: "gold",
  PRICING: "red",
} as const;

export const dealerStatusLabels = {
  ACTIVE: "有効",
  INACTIVE: "無効",
} as const;

export const roleLabels = {
  HQ_ADMIN: "本店管理者",
  DEALER: "代理店",
} as const;

/** 日付を YYYY/MM/DD 表記に */
export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

/** 日時を YYYY/MM/DD HH:mm 表記に */
export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}
