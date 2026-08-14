/*
 * メーカー固有オプション（アイドリングストップ解除・コールドスタートオフ）の
 * 出し分け検証。DB不要・オフラインで動く。
 *
 * ここで守りたいこと:
 *   - BMW / Audi / Porsche / Volkswagen では選べる（英字・日本語表記・実データの綴り差を吸収）
 *   - それ以外のメーカーには出さない（選べるのに作れない依頼を作らない）
 *   - 燃料の出し分け（ガソリンはAdblue/DPF/EGRを出さない等）を壊していない
 *   - 有料OPの数え方（バブリング強だけ無料）を壊していない
 */
import {
  optionTagsFor,
  makerOptionTags,
  paidTags,
  IDLING_STOP_TAG,
  COLD_START_OFF_TAG,
  POPS_STRONG_TAG,
  SPEED_LIMITER_TAG,
} from "../src/lib/catalog/options";

let fail = 0;
let n = 0;
function ok(label: string, cond: boolean) {
  n++;
  if (!cond) fail++;
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
}

console.log("[1] 対応メーカーでは選べる");
for (const m of [
  "BMW",
  "bmw",
  "BMW AG",
  "Audi",
  "AUDI AG",
  "アウディ",
  "Porsche",
  "ポルシェ",
  "Volkswagen",
  "VW",
  "フォルクスワーゲン",
]) {
  const tags = optionTagsFor("gasoline", m);
  ok(`${m}: アイドリングストップ解除あり`, tags.includes(IDLING_STOP_TAG));
  ok(`${m}: コールドスタートオフあり`, tags.includes(COLD_START_OFF_TAG));
}

console.log("[2] 対応外メーカーには出さない");
for (const m of ["Mercedes-Benz", "メルセデス・ベンツ", "Ferrari", "Toyota", "Lamborghini", "MINI", "", null]) {
  const tags = optionTagsFor("gasoline", m);
  ok(
    `${m || "(空)"}: メーカー固有OPなし`,
    !tags.includes(IDLING_STOP_TAG) && !tags.includes(COLD_START_OFF_TAG),
  );
}

console.log("[3] ディーゼルでも対応メーカーなら選べる（アイドリングストップは燃料に依らない）");
{
  const tags = optionTagsFor("diesel", "Volkswagen");
  ok("VWディーゼル: アイドリングストップ解除あり", tags.includes(IDLING_STOP_TAG));
  ok("VWディーゼル: Adblue も出る", tags.includes("Adblue"));
  ok("VWディーゼル: バブリング強は出ない", !tags.includes(POPS_STRONG_TAG));
}

console.log("[4] 既存の出し分けを壊していない");
{
  const gas = optionTagsFor("gasoline", "Ferrari");
  ok("ガソリン: Adblue/DPF/EGRを出さない", !["Adblue", "DPF", "EGR"].some((t) => gas.includes(t)));
  ok("ガソリン: バブリング強を出す", gas.includes(POPS_STRONG_TAG));
  ok("全車: スピードリミッターカットを出す", gas.includes(SPEED_LIMITER_TAG));
  ok("重複なし", new Set(gas).size === gas.length);
}

console.log("[5] 有料OPの数え方（バブリング強だけ無料）");
{
  const paid = paidTags([POPS_STRONG_TAG, IDLING_STOP_TAG, COLD_START_OFF_TAG]);
  ok("メーカー固有OPは有料に数える", paid.includes(IDLING_STOP_TAG) && paid.includes(COLD_START_OFF_TAG));
  ok("バブリング強は有料に数えない", !paid.includes(POPS_STRONG_TAG));
}

console.log("[6] makerOptionTags 単体");
ok("BMWは2件", makerOptionTags("BMW").length === 2);
ok("空文字は0件", makerOptionTags("").length === 0);

console.log("");
console.log(fail === 0 ? `✅ ${n}件すべて通過` : `❌ ${fail}/${n}件 失敗`);
process.exit(fail === 0 ? 0 : 1);
