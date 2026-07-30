/*
 * 価格表の列順ルールと、WordPress REST保存の安全性の検証（DB不要）。
 *
 *   npm run check:price-columns
 *
 * 守りたいこと:
 *  1. 工賃列は**メインのECUチューニング価格列の直後**（純正出力・Stage1出力向上・
 *     リミッター解除OP・Stage2 より前）。本番で人が手作業で直した並びがこれ。
 *  2. メイン価格列の名前はブランドごとに違う。キーだけで判定しない。
 *  3. 工賃データが無いブランドは列を作らない。
 *  4. 生成HTMLの <script> にアンパサンドを書かない（REST保存で &#038; に変換され壊れる）。
 */
import {
  applyColumnOrderRule,
  findMainPriceIndex,
  buildGeneratedTemplate,
} from "../src/lib/prices/generated-template";
import { restSafe, headerCells, scriptBodies } from "../src/lib/prices/wp-sync";
import type { ColumnDefinition } from "../src/lib/prices/types";

let failed = 0;
function ok(cond: boolean, label: string, detail?: string) {
  if (cond) console.log(`  ✓ ${label}`);
  else {
    failed++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

let order = 0;
const col = (key: string, label: string, type: ColumnDefinition["type"]): ColumnDefinition => ({
  key,
  label,
  type,
  order: order++,
});
const labels = (cols: ColumnDefinition[]) => cols.map((c) => c.label).join(" | ");
/** 工賃が何番目か（0始まり。無ければ -1） */
const laborAt = (cols: ColumnDefinition[]) => cols.findIndex((c) => c.type === "labor");

console.log("[1] メイン価格列の同定（ブランドごとに名前が違う）");
const mercedesGasoline = [
  col("car", "車種", "text"),
  col("grade", "グレード", "text"),
  col("engine", "エンジン", "text"),
  col("babble", "バブリングのみ", "price"),
  col("stage1", "Stage1(バブ無料)", "price"),
  col("stage15", "Stage1.5", "price"),
  col("stage2", "Stage2", "price"),
  col("labor", "脱着・殻割工賃", "labor"),
  col("stockOutput", "純正出力", "output"),
  col("stage1Gain", "Stage1出力向上", "output"),
];
ok(
  mercedesGasoline[findMainPriceIndex(mercedesGasoline)]?.label === "Stage1(バブ無料)",
  "Mercedes(ガソリン) は Stage1(バブ無料) がメイン",
);

const mercedesDiesel = [
  col("car", "車種", "text"),
  col("grade", "グレード", "text"),
  col("ecuTuning", "ECUチューニング", "price"),
  col("adblueCut", "アドブルーカット", "price"),
  col("labor", "脱着・殻割工賃", "labor"),
  col("stockOutput", "純正出力", "output"),
];
ok(
  mercedesDiesel[findMainPriceIndex(mercedesDiesel)]?.label === "ECUチューニング",
  "Mercedes(ディーゼル) は ECUチューニング がメイン",
);

// Ferrari 等: キーが tuning でもラベルで拾えること
const ferrari = [
  col("car", "車種", "text"),
  col("tuning", "ECUチューニング(バブリング無料)", "price"),
  col("limiterOpt", "リミッター解除OP", "price"),
  col("labor", "脱着工賃", "labor"),
  col("stockOutput", "純正出力", "output"),
];
ok(
  ferrari[findMainPriceIndex(ferrari)]?.label === "ECUチューニング(バブリング無料)",
  "Ferrari は ECUチューニング(バブリング無料) がメイン（キーは tuning）",
);

// キーが未知でもラベルで判定できること（列名判定の担保）
const unknownKey = [
  col("car", "車種", "text"),
  col("mainPrice", "ECUﾁｭｰﾆﾝｸﾞ(ﾊﾞﾌﾞﾘﾝｸﾞ無料)", "price"),
  col("o2opf", "O2/OPFカット", "price"),
  col("labor", "工賃", "labor"),
];
ok(
  unknownKey[findMainPriceIndex(unknownKey)]?.label === "ECUﾁｭｰﾆﾝｸﾞ(ﾊﾞﾌﾞﾘﾝｸﾞ無料)",
  "キーが未知でも半角カナのラベルからメイン列を拾える",
);

console.log("[2] 工賃はメイン価格列の直後（出力向上や追加OPより前）");
const ordered = applyColumnOrderRule(unknownKey);
ok(
  laborAt(ordered) === 2,
  "追加OP(O2/OPFカット)より前に工賃が入る",
  labels(ordered),
);
const orderedFerrari = applyColumnOrderRule(ferrari);
ok(
  laborAt(orderedFerrari) === 2 && orderedFerrari[3].label === "リミッター解除OP",
  "リミッター解除OPより前に工賃が入る",
  labels(orderedFerrari),
);
const orderedMb = applyColumnOrderRule(mercedesGasoline);
ok(
  orderedMb[laborAt(orderedMb) - 1].label === "Stage1(バブ無料)",
  "Mercedes(ガソリン) は Stage1(バブ無料) の直後",
  labels(orderedMb),
);
ok(
  orderedMb[laborAt(orderedMb) + 1].label === "Stage1.5",
  "Stage1.5・Stage2 は工賃より後ろ",
  labels(orderedMb),
);
const orderedMbD = applyColumnOrderRule(mercedesDiesel);
ok(
  orderedMbD[laborAt(orderedMbD) - 1].label === "ECUチューニング" &&
    orderedMbD[laborAt(orderedMbD) + 1].label === "アドブルーカット",
  "Mercedes(ディーゼル) は ECUチューニングの直後（アドブルーカットより前）",
  labels(orderedMbD),
);
ok(
  !applyColumnOrderRule(orderedFerrari)
    .map((c) => c.type)
    .join(",")
    .includes("labor,labor"),
  "二重適用しても工賃が増えない（べき等）",
);
ok(
  labels(applyColumnOrderRule(orderedFerrari)) === labels(orderedFerrari),
  "二重適用で並びが変わらない（べき等）",
);

console.log("[3] 工賃データが無いブランドは列を作らない");
const audi = [
  col("car", "車種", "text"),
  col("babble", "バブリング", "price"),
  col("stage1", "Stage1", "price"),
  col("tcu", "TCUチューニング", "price"),
  col("stockOutput", "純正出力", "output"),
];
ok(labels(applyColumnOrderRule(audi)) === labels(audi), "Audi等（工賃なし）は並びを変えない");
ok(applyColumnOrderRule(audi).every((c) => c.type !== "labor"), "工賃列を勝手に足さない");

console.log("[4] 以前の実装で起きていた取り違えが再発しないこと");
// key が stage1 でないブランドで「最後の価格列の直後」に落ちると、工賃が追加OPより後ろになる
const legacyWrong = [...ferrari].filter((c) => c.type !== "labor");
const lastPriceIdx = legacyWrong.map((c) => c.type).lastIndexOf("price");
ok(
  findMainPriceIndex(legacyWrong) !== lastPriceIdx,
  "メイン列＝最後の価格列 ではない（旧フォールバックとは違う位置を返す）",
);

console.log("[5] REST保存の安全性（<script> にアンパサンドを書かない）");
// 実際にテンプレートを生成して、出てきたHTMLの <script> を検査する
// （ソースを文字列で切り出すとコメント中の "<script>" を拾って誤判定する）
const tpl = buildGeneratedTemplate({
  id: "ferrari",
  displayName: "Ferrari",
  slug: "ferrari",
  namespacePrefix: "ferrari-",
  seriesGroups: ["V8", "V12"],
  columns: ferrari,
  intro: "",
  jsonLdDescription: "",
  wordPressPageId: null,
  vehicleCount: 0,
});
const generatedHtml = `${tpl.head}${tpl.foot}`;
const bodies = scriptBodies(generatedHtml);
ok(bodies.length > 0, "生成HTMLから script を取り出せる");
const safe = restSafe(generatedHtml);
ok(safe.ok, "生成HTMLの script にアンパサンドが無い（REST保存で壊れない）", safe.reason);
ok(
  !bodies.some((b) => b.includes("<")),
  "生成HTMLの script に小なり記号が無い（比較は大なり側に寄せている）",
);

ok(
  restSafe("<div>a &amp; b</div>").ok,
  "本文（script外）のアンパサンドは許す（属性・テキストでは実害なし）",
);
ok(!restSafe("<script>if (a && b) {}</script>").ok, "script内のアンパサンドは弾く");
ok(
  !restSafe('<script>var u = "?a=1&b=2";</script>').ok,
  "script内のクエリ文字列のアンパサンドも弾く（mbPITで実害が出た形）",
);
ok(
  restSafe('<script>var amp = String.fromCharCode(38); var u = "?a=1" + amp + "b=2";</script>').ok,
  "String.fromCharCode(38) で組めば通る",
);
ok(scriptBodies("<script>a</script><script type=\"x\">b</script>").length === 2, "script を全て見る");

console.log("[6] 列順の比較（差分レポートの土台）");
ok(
  headerCells(
    "<table><thead><tr><th>車種</th><th>ECU<br>チューニング</th><th>脱着 工賃</th></tr></thead></table>",
  ).join("|") === "車種|ECUチューニング|脱着工賃",
  "theadの見出しをタグ・空白を落として順番に取れる",
);

console.log(failed === 0 ? "\n✅ すべて通過" : `\n❌ ${failed} 件失敗`);
process.exit(failed === 0 ? 0 : 1);
