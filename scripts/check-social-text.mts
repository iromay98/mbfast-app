/*
 * SNS投稿文の生成を検査・プレビューする（送信しない）。
 *   npm run check:social-text
 *
 * 上限超過は媒体側に弾かれるため、送る前にここで担保する。
 */
import { buildSocialText, coreTitle, LIMITS, type SocialProvider } from "../src/lib/pit/social-text";

const PROVIDERS: SocialProvider[] = ["x", "threads", "instagram"];
let ng = 0;
const t = (ok: boolean, label: string) => {
  console.log(`  ${ok ? "OK" : "NG"}  ${label}`);
  if (!ok) ng++;
};

const rec = {
  title: "【施工記録】BMW X5M Competition ECUチューニング＋バブリング施工｜アクラポビッチのコールドスタートもオフに｜mbFAST Tuning",
  vehicle: "BMW X5M Competition",
  genre: "チューニング（エンジン・駆動系）",
  memo: "アクラポビッチ装着車のコールドスタート音を抑えつつ、アイドリングストップの解除まで対応しました。",
  articleUrl: "https://mbfasttuning.com/mbpit/mbfast-tuning/bmw-x5m-competition-ecu-tuning-20260808/",
  storeName: "mbFAST Tuning",
};

for (const p of PROVIDERS) {
  const text = buildSocialText(p, rec);
  console.log("=".repeat(58));
  console.log(`【${p}】 ${text.length}字 / 上限 ${LIMITS[p]}`);
  console.log(text);
  console.log();
  t(text.length <= LIMITS[p], `${p}: 上限に収まる`);
  t(text.includes(rec.articleUrl), `${p}: 記事URLが残る`);
  t(!text.includes("【"), `${p}: タイトルの装飾を落とす`);
  t(!text.includes("mbFAST Tuning"), `${p}: 店名を重ねない（その店の名義で投稿するため）`);
}

// 長文でも上限に収まり、URLは必ず残る（末尾から本文を削る設計）
const long = buildSocialText("x", { ...rec, memo: "あ".repeat(2000) });
t(long.length <= LIMITS.x, "x: 長文でも上限に収まる");
t(long.includes(rec.articleUrl), "x: 長文でもURLが消えない");
t(long.includes("…"), "x: 切り詰めたことが分かる");

// メモ無し・ジャンル無しでも成立する
const bare = buildSocialText("x", { ...rec, memo: null, genre: null });
t(bare.length > 0 && !bare.includes("null") && !bare.includes("undefined"), "x: メモ/ジャンル無しでも成立");

t(coreTitle("【施工記録】ウラカン バブリング｜Reboot Tipo") === "ウラカン バブリング", "タイトル整形が効く");

if (ng > 0) {
  console.error(`\n${ng} 件失敗しました。`);
  process.exit(1);
}
console.log("\nすべて通りました。");
