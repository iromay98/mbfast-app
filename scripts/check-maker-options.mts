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
  baselineStages,
  popsAllowed,
  makerOptionTags,
  paidTags,
  IDLING_STOP_TAG,
  COLD_START_OFF_TAG,
  POPS_STRONG_TAG,
  SPEED_LIMITER_TAG,
  tuningContentLabel,
  parseTuningContentLabel,
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

console.log("[7] TCU（ミッション）はエンジン側の選択肢を出さない");
{
  // TCUはバブリング・O2/NOx/DTC・Adblue等・リミッターカット・メーカー固有OPを一切出さない
  for (const maker of ["BMW", "Volkswagen", "Mercedes-Benz", "Toyota"]) {
    ok(`${maker}(TCU): オプション0件`, optionTagsFor("gasoline", maker, "TCU").length === 0);
    ok(`${maker}(TCU): バブリング不可`, popsAllowed("gasoline", "TCU") === false);
  }
  ok("TCU(ディーゼル)でもオプション0件", optionTagsFor("diesel", "Volkswagen", "TCU").length === 0);
  // ステージは Stage1 の1本だけ（「チューニングなし」も出さない）
  const st = baselineStages("Mercedes-Benz", "TCU");
  ok("TCU: ステージはStage1のみ", st.length === 1 && st[0] === "Stage1");
  // ECU側は従来どおり（ベンツはStage1.5あり・チューニングなしあり）
  const ecuSt = baselineStages("Mercedes-Benz", "ECU");
  ok("ECU(ベンツ): 従来どおり4段階", ecuSt.length === 4 && ecuSt.includes("Stage1.5"));
  ok("unit未指定はECU扱い", optionTagsFor("gasoline", "BMW").length > 0);
  ok("小文字tcuも判定できる", optionTagsFor("gasoline", "BMW", "tcu").length === 0);
}

console.log("[8] 納品内容ラベルの往復（画面の選択 → ラベル → 解析）");
{
  /*
   * 納品時の「異なる仕様」は、選択 → tuningContentLabel でラベル化 → サーバーの
   * registerVariationFromDelivery が parseTuningContentLabel で読み直して登録する。
   * ここが崩れると納品内容と登録内容が食い違うので、往復を固定する。
   */
  const cases: { stage: string; pops: boolean; popsSport: boolean; tags: string[] }[] = [
    { stage: "", pops: false, popsSport: false, tags: [] },
    { stage: "Stage1", pops: false, popsSport: false, tags: [] },
    { stage: "Stage1", pops: true, popsSport: false, tags: ["O2"] },
    { stage: "Stage1.5", pops: true, popsSport: true, tags: ["O2", "DTC"] },
    { stage: "Stage2", pops: true, popsSport: false, tags: [POPS_STRONG_TAG] },
    { stage: "Stage1", pops: false, popsSport: false, tags: [IDLING_STOP_TAG, COLD_START_OFF_TAG] },
    { stage: "Stage1", pops: false, popsSport: false, tags: [SPEED_LIMITER_TAG] },
  ];
  for (const c of cases) {
    const label = tuningContentLabel(c.stage, c.pops, c.tags, c.popsSport);
    const back = parseTuningContentLabel(label);
    const same =
      !!back &&
      back.stage === c.stage &&
      back.pops === c.pops &&
      back.popsSport === c.popsSport &&
      back.optionTags.slice().sort().join("|") === c.tags.slice().sort().join("|");
    ok(`往復一致: ${label}`, same);
  }
}

console.log("");
console.log(fail === 0 ? `✅ ${n}件すべて通過` : `❌ ${fail}/${n}件 失敗`);
process.exit(fail === 0 ? 0 : 1);
