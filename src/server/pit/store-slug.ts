/*
 * mbPIT 店舗slugの命名規則（唯一の原本）。
 *
 * 規則（本部確定・2026-08）:
 *   - 英小文字・数字・ハイフンのみ（`^[a-z0-9-]+$`）。表示名は日本語で良い
 *   - 単語の区切りは**ハイフン**（例: mcc-complete / charism-garage）
 *   - `-mbpit` / `-dealer` 等の接尾辞は**付けない**。過去にこの接尾辞で作った
 *     カテゴリ（glanzcoat-mbpit 等）が運用の混乱を生んだため、入力に含まれていても剥がす
 *   - mbPIT側（親545）は常にこの「きれいなslug」を取る。本体ブログ側の代理店カテゴリ
 *     （親355・ハイフン無し表記）とは別ツリーだが、WPのカテゴリslugはタクソノミー全体で
 *     一意なので、単語1つの店名（glanzcoat 等）は衝突し得る。衝突の扱いは provision.ts
 *     が判定し、自動では解決しない（本部が手動判断）
 *
 * 店舗slugはURL（/mbpit/{slug}/）と記事slug末尾に焼き込まれるため、確定後の変更は禁止。
 */

const LEGACY_SUFFIX = /-(mbpit|dealer|store|shop)$/;

/** 入力（手入力・自動生成）を規則に沿って正規化する。日本語など変換できない部分は落ちる */
export function normalizeStoreSlug(input: string): string {
  let s = input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // ダイアクリティカルマーク除去（é→e）
    .toLowerCase()
    .replace(/['’]/g, "") // On's → ons
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  // 接尾辞は繰り返し剥がす（glanzcoat-mbpit-dealer のような多重も想定）
  for (;;) {
    const next = s.replace(LEGACY_SUFFIX, "");
    if (next === s) break;
    s = next;
  }
  return s;
}

/** 規則に合致するか（正規化済みの値を検査する。空・短すぎ・長すぎは不可） */
export function isValidStoreSlug(slug: string): boolean {
  return /^[a-z0-9-]{3,40}$/.test(slug) && !LEGACY_SUFFIX.test(slug);
}

/** 店名から候補slugを作る。日本語のみの店名は空文字（＝本部が手入力する） */
export function suggestStoreSlug(name: string): string {
  const s = normalizeStoreSlug(name);
  return isValidStoreSlug(s) ? s : "";
}

/** 入力にあった接尾辞・記号を剥がした結果、元の入力と違っていれば true（画面で注意喚起に使う） */
export function slugWasRewritten(input: string): boolean {
  const trimmed = input.trim().toLowerCase();
  return trimmed !== "" && trimmed !== normalizeStoreSlug(trimmed);
}
