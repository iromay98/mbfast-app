/*
 * Googleマップ投稿の文面を検査・プレビューする（送信しない）。
 *
 *   npm run check:map-post
 *
 * GBPの投稿は作成後に編集できないため、出す前に文面を確かめられるようにしておく。
 */
import { buildMapPostText } from "../src/lib/pit/map-post-text";
import { LOCAL_POST_SUMMARY_MAX } from "../src/server/pit/gbp/client";

let ng = 0;
const t = (ok: boolean, label: string) => {
  console.log(`  ${ok ? "OK" : "NG"}  ${label}`);
  if (!ok) ng++;
};

const full = buildMapPostText({
  vehicle: "BMW X5M Competition",
  title: "【施工記録】BMW X5M Competition ECUチューニング＋バブリング施工｜アクラポビッチのコールドスタートもオフに｜mbFAST Tuning",
  memo: "アクラポビッチ装着車。コールドスタート音を抑えつつ、アイドリングストップも解除しました。",
});
console.log("─".repeat(58));
console.log(full);
console.log("─".repeat(58));

t(!full.includes("【"), "タイトルの装飾【施工記録】を落とす");
t(!full.includes("mbFAST Tuning"), "店名を本文に重ねない（投稿先がその店なので不要）");
t(full.startsWith("BMW X5M Competition"), "車種で始まる（一覧は先頭しか読まれない）");
t(full.length <= LOCAL_POST_SUMMARY_MAX, `本文が上限${LOCAL_POST_SUMMARY_MAX}字以内`);

const noMemo = buildMapPostText({ vehicle: "ウラカン", title: "【施工記録】ウラカン バブリング｜Reboot Tipo", memo: null });
t(noMemo.trim().length > 0 && !noMemo.includes("null"), "メモ無しでも成立する");

const long = buildMapPostText({ vehicle: "X", title: "【施工記録】X", memo: "あ".repeat(2000) });
t(long.length <= LOCAL_POST_SUMMARY_MAX, "長いメモでも上限に収まる");
t(long.includes("…"), "長いメモは省略記号で切る");

if (ng > 0) {
  console.error(`\n${ng} 件失敗しました。`);
  process.exit(1);
}
console.log("\nすべて通りました。");
