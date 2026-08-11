/*
 * mbPIT公式ジャンル（本部管理）へのアクセスヘルパ。
 *
 * 単一の正は src/config/mbpit-genres.json。ジャンルの追加・改名はJSONだけを編集する
 * （このファイルにジャンル名やIDをハードコードしない）。UIの選択肢・APIの入力検証・
 * WPタグ付与・表示ラベルはすべてここ経由で参照する。
 *
 * 旧5区分（ecu/coating/polish/maintenance/other）からの変更点:
 *   - polish は coating（コーティング・磨き）に統合、other は廃止（→ maintenance に正規化）
 *   - DBの既存行には旧値が残るため、ラベル解決(genreLabel)は旧値も引ける
 */
import genresJson from "@/config/mbpit-genres.json";

export type Genre = { slug: string; label: string; wpTagId: number };

/** 公式ジャンル（表示順）。投稿フォーム等のUIはこの配列から選択肢を生成する */
export const GENRES: Genre[] = genresJson.genres.map((g) => ({
  slug: g.slug,
  label: g.label,
  wpTagId: g.wpTagId,
}));

/** 現行の公式slug集合（APIの入力検証用） */
export const GENRE_SLUGS: ReadonlySet<string> = new Set(GENRES.map((g) => g.slug));

/** slug → 表示ラベル。旧区分(polish/other)の行も表示できるよう旧ラベルを含む */
export const GENRE_LABELS: Record<string, string> = Object.fromEntries([
  ...GENRES.map((g) => [g.slug, g.label] as const),
  ...Object.entries(genresJson.legacyCategories)
    .filter(([k]) => k !== "_readme")
    .map(([k, v]) => [k, (v as { label: string }).label] as const),
]);

/** 旧slugを現行slugへ正規化（現行slugはそのまま返す）。未知の値もそのまま返す */
export function normalizeGenreSlug(slug: string): string {
  const legacy = (genresJson.legacyCategories as Record<string, unknown>)[slug];
  if (legacy && typeof legacy === "object" && "currentSlug" in legacy) {
    return (legacy as { currentSlug: string }).currentSlug;
  }
  return slug;
}

/** ジャンルslug → WPタグID（未知の区分は付けない）。ポータルのジャンル絞り込みが参照する */
export function wpTagIdsForGenre(slug: string): number[] {
  const g = GENRES.find((x) => x.slug === normalizeGenreSlug(slug));
  return g ? [g.wpTagId] : [];
}
