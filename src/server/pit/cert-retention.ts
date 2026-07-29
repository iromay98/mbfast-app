/*
 * 証明書の保存期間（目的別）。
 *
 * レビューで確定した方針:
 *  - 一律の期間にしない。「なぜ保持するのか」で期間が変わる
 *  - 加盟店が退会しても、法定記録簿の保存義務（記載日から2年）は事業者本人に残る。
 *    したがって退会時にデータを消してはならない（退会時エクスポートは Step E で実装）
 *  - コーティングの保証は5年のものもあるため、2年で消すと保証が使えなくなる
 *  - 顧客氏名・住所のマスクは「画面表示と検索」に対して行う。法定記録簿の実体は
 *    記載事項なのでマスクしない（マスクすると記録として要件を満たさなくなる）
 */

export type RetentionReason = "legal_record" | "warranty" | "none";

/** 法定記録簿の保存期間（道路運送車両法: 記載の日から2年間） */
const LEGAL_RECORD_YEARS = 2;

function addYears(d: Date, years: number): Date {
  const x = new Date(d);
  x.setFullYear(x.getFullYear() + years);
  return x;
}

/**
 * 保存期限を決める。
 * 法定記録簿と保証の両方に該当する場合は、遅い方（＝長く残る方）を採用する。
 */
export function resolveRetention(input: {
  /** 記録簿の記載日（＝発行日。未発行なら施工日で仮置き） */
  recordedOn: Date;
  legalRecord: boolean;
  /** 保証期間の満了日（コーティング等。分かる場合のみ） */
  warrantyUntil?: Date | null;
}): { retentionUntil: Date | null; retentionReason: RetentionReason } {
  const legalUntil = input.legalRecord ? addYears(input.recordedOn, LEGAL_RECORD_YEARS) : null;
  const warrantyUntil = input.warrantyUntil ?? null;

  if (legalUntil && warrantyUntil) {
    return warrantyUntil > legalUntil
      ? { retentionUntil: warrantyUntil, retentionReason: "warranty" }
      : { retentionUntil: legalUntil, retentionReason: "legal_record" };
  }
  if (legalUntil) return { retentionUntil: legalUntil, retentionReason: "legal_record" };
  if (warrantyUntil) return { retentionUntil: warrantyUntil, retentionReason: "warranty" };
  return { retentionUntil: null, retentionReason: "none" };
}

/** いま削除してよいか（保持理由なし、または保存期限を過ぎている） */
export function isDeletable(
  cert: { retentionUntil: Date | null; retentionReason: string },
  now = new Date(),
): boolean {
  if (cert.retentionReason === "none" || !cert.retentionUntil) return true;
  return cert.retentionUntil.getTime() <= now.getTime();
}

/**
 * 画面表示・検索用の氏名マスク（記録簿の実体はマスクしない）。
 * 退会後など、業務上の閲覧が不要になった顧客情報の露出を抑えるために使う。
 */
export function maskPersonName(name: string): string {
  const n = name.trim();
  if (n.length <= 1) return "＊";
  return `${n[0]}${"＊".repeat(Math.min(n.length - 1, 3))}`;
}

/*
 * 画面表示・検索用の住所マスク（市区町村まで残し、それ以降を落とす）。
 * 政令指定都市は「市」で切ると区が落ちて別の場所になってしまうため、
 * 「◯◯市△△区」まで残す。郡部は「◯◯郡△△町」まで残す。
 */
const PREFECTURE_RE = /^(東京都|北海道|京都府|大阪府|.{2,3}?県)/;
const LOCALITY_RE = /^(.{1,8}?郡.{1,8}?[町村]|.{1,8}?市.{1,6}?区|.{1,8}?[市区町村])/;

export function maskAddress(address: string): string {
  const src = address.trim();
  if (!src) return "";
  const pref = src.match(PREFECTURE_RE);
  const head = pref ? pref[1] : "";
  const rest = src.slice(head.length);
  const loc = rest.match(LOCALITY_RE);
  if (!loc) return head ? `${head} 以下略` : "（非表示）";
  return `${head}${loc[1]} 以下略`;
}
