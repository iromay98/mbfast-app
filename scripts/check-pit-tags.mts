/*
 * mbPIT: 施工区分とWPタグIDの対応が崩れていないことを検査する。
 *
 * なぜ必要か:
 * 1. 投稿フォーム／APIの区分に新しい値を足したのにタグIDを足し忘れると、
 *    その区分の記事だけ**無言でタグ無し**になり、ポータルの絞り込みから消える。
 *    実行時エラーにならないので画面を見ても気づけない。
 * 2. mbFAST本体のブログが使っている既存タグ「ECUチューニング」(ID 365) を
 *    ここに書くと、mbPITの施工記録とmbFAST本体の記事が同じタグアーカイブに混ざる。
 *    ブランド分離が崩れるので**絶対に混ぜない**。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** mbFAST本体のブログが使っている既存タグ。mbPITでは使わない */
const MBFAST_ECU_TAG_ID = 365;

const wp = readFileSync(join(process.cwd(), "src/server/pit/wordpress.ts"), "utf-8");
const api = readFileSync(join(process.cwd(), "src/app/api/pit/posts/route.ts"), "utf-8");
const form = readFileSync(join(process.cwd(), "src/app/dealer/pit/pit-post-form.tsx"), "utf-8");

let failed = 0;
const fail = (m: string) => {
  console.error(`  ❌ ${m}`);
  failed++;
};

// ── タグ対応表を読む ────────────────────────────────────────────
const mapBlock = wp.match(/PIT_CATEGORY_TAG_IDS[^=]*=\s*\{([\s\S]*?)\n\};/);
if (!mapBlock) {
  console.error("PIT_CATEGORY_TAG_IDS が wordpress.ts に見つかりません");
  process.exit(1);
}
const tagIds = new Map<string, number>();
for (const m of mapBlock[1].matchAll(/^\s*(\w+):\s*(\d+)/gm)) tagIds.set(m[1], Number(m[2]));

console.log("区分 → WPタグID");
for (const [k, v] of tagIds) console.log(`  ${k.padEnd(12)} ${v}`);
console.log("");

// ── サーバー側の許可リストと突き合わせる ──────────────────────────
const apiSet = api.match(/CATEGORIES\s*=\s*new Set\(\[([^\]]*)\]\)/);
if (!apiSet) {
  console.error("API側の CATEGORIES が見つかりません");
  process.exit(1);
}
const apiCats = [...apiSet[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);

console.log("検査");
for (const c of apiCats) {
  if (!tagIds.has(c)) fail(`区分 "${c}" にWPタグIDが未設定（この区分の記事はタグ無しで公開される）`);
}
for (const c of tagIds.keys()) {
  if (!apiCats.includes(c)) fail(`タグIDの "${c}" はAPIの許可リストに無い区分（消し忘れ）`);
}

// ── 投稿フォームの選択肢とも突き合わせる ────────────────────────
const formCats = [...form.matchAll(/\{\s*value:\s*"([^"]+)",\s*label:/g)].map((m) => m[1]);
for (const c of formCats) {
  if (!tagIds.has(c)) fail(`投稿フォームの区分 "${c}" にWPタグIDが未設定`);
}

// ── mbFAST本体のタグを混ぜていないか ───────────────────────────
for (const [k, v] of tagIds) {
  if (v === MBFAST_ECU_TAG_ID) {
    fail(
      `区分 "${k}" に ${MBFAST_ECU_TAG_ID} が指定されています。` +
        "これはmbFAST本体のブログが使っている既存タグで、共用するとmbPITの施工記録と混ざります",
    );
  }
}

// ── ID重複（コピペ事故）────────────────────────────────────────
const seen = new Map<number, string>();
for (const [k, v] of tagIds) {
  const prev = seen.get(v);
  if (prev) fail(`タグID ${v} が "${prev}" と "${k}" で重複しています`);
  seen.set(v, k);
}

console.log("");
if (failed) {
  console.error(`${failed}件の問題があります。`);
  process.exit(1);
}
console.log(`区分 ${apiCats.length}種すべてにWPタグIDが対応しています`);
