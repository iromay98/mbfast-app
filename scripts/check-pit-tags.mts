/*
 * mbPIT: 公式ジャンル定義（src/config/mbpit-genres.json）の整合を検査する。
 *
 * 2026-08 の8ジャンル化で、投稿フォーム・API許可リスト・WPタグ付与は全て
 * src/lib/mbpit-genres.ts 経由で同じJSONから導出される構造になった。
 * そのため旧来の「3ファイル間の突き合わせ」は構造的に不要になり、検査対象は
 *   1. JSONそのものの整合（slug/ID重複・欠落・旧slug参照切れ）
 *   2. mbFAST本体のブログ用タグ「ECUチューニング」(ID 365) を混ぜていないこと
 *      （共用するとmbPITの施工記録とmbFAST本体の記事が同じタグアーカイブに混ざり、
 *      ブランド分離が崩れる。**絶対に混ぜない**）
 *   3. 消費側ファイルがJSON由来のヘルパを使い続けていること（ハードコード再発防止）
 * の3点になった。ジャンルを追加・改名したらJSONだけを直し、この検査を通すこと。
 * WP側に同slugのタグを先に作り、その固定IDをJSONに書く（実行時の自動作成はしない）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** mbFAST本体のブログが使っている既存タグ。mbPITでは使わない */
const MBFAST_ECU_TAG_ID = 365;

let failed = 0;
const fail = (m: string) => {
  console.error(`  ❌ ${m}`);
  failed++;
};

// ── 1. ジャンルマスターの整合 ──────────────────────────────────
type GenreJson = {
  genres: { slug: string; label: string; wpTagId: number }[];
  legacyCategories: Record<string, { label?: string; currentSlug?: string } | string>;
};
const raw = readFileSync(join(process.cwd(), "src/config/mbpit-genres.json"), "utf-8");
const master = JSON.parse(raw) as GenreJson;

if (!Array.isArray(master.genres) || master.genres.length === 0) {
  console.error("mbpit-genres.json に genres がありません");
  process.exit(1);
}

console.log("公式ジャンル → WPタグID");
for (const g of master.genres) console.log(`  ${g.slug.padEnd(18)} ${g.wpTagId}  ${g.label}`);
console.log("");

console.log("検査");
const slugSeen = new Set<string>();
const idSeen = new Map<number, string>();
for (const g of master.genres) {
  if (!g.slug || !/^[a-z0-9-]+$/.test(g.slug)) fail(`slug "${g.slug}" が命名規則（英小文字）に反しています`);
  if (!g.label) fail(`ジャンル "${g.slug}" にラベルがありません`);
  if (slugSeen.has(g.slug)) fail(`slug "${g.slug}" が重複しています`);
  slugSeen.add(g.slug);
  if (!Number.isInteger(g.wpTagId) || g.wpTagId <= 0) {
    fail(`ジャンル "${g.slug}" のwpTagIdが未設定です（この区分の記事はタグ無しで公開される）`);
  } else {
    const prev = idSeen.get(g.wpTagId);
    if (prev) fail(`タグID ${g.wpTagId} が "${prev}" と "${g.slug}" で重複しています`);
    idSeen.set(g.wpTagId, g.slug);
  }
  // ── 2. mbFAST本体のタグを混ぜていないか ──
  if (g.wpTagId === MBFAST_ECU_TAG_ID) {
    fail(
      `ジャンル "${g.slug}" に ${MBFAST_ECU_TAG_ID} が指定されています。` +
        "これはmbFAST本体のブログが使っている既存タグで、共用するとmbPITの施工記録と混ざります",
    );
  }
}
for (const [key, v] of Object.entries(master.legacyCategories)) {
  if (key.startsWith("_")) continue;
  const cur = typeof v === "object" ? v.currentSlug : undefined;
  if (!cur || !slugSeen.has(cur)) {
    fail(`旧区分 "${key}" の currentSlug "${cur}" が現行ジャンルに存在しません`);
  }
}

// ── 3. 消費側がヘルパ経由のままか（ハードコード再発防止）──────────
const consumers: [string, RegExp, string][] = [
  ["src/server/pit/wordpress.ts", /wpTagIdsForGenre/, "タグ付与が mbpit-genres 由来でなくなっています"],
  ["src/app/api/pit/posts/route.ts", /GENRE_SLUGS/, "APIの許可リストが mbpit-genres 由来でなくなっています"],
  ["src/app/dealer/pit/pit-post-form.tsx", /GENRES/, "投稿フォームの選択肢が mbpit-genres 由来でなくなっています"],
  ["src/app/hq/pit/pit-admin.tsx", /GENRES/, "本部投稿フォームの選択肢が mbpit-genres 由来でなくなっています"],
];
for (const [file, pattern, msg] of consumers) {
  const src = readFileSync(join(process.cwd(), file), "utf-8");
  if (!pattern.test(src)) fail(`${file}: ${msg}`);
}

console.log("");
if (failed) {
  console.error(`${failed}件の問題があります。`);
  process.exit(1);
}
console.log(`公式ジャンル ${master.genres.length}種すべてにWPタグIDが対応しています`);
