/*
 * バリエーションの「差し替え」が必ず狙った行に効くことの検証（DB不要）。
 *
 * 守りたいこと（過去の不具合＝差し替えても差し替わらない）:
 *  1. 一覧の差し替えは variantId で行を特定する。構成から引き直すと、選択肢に無いOP
 *     （燃料を直した後の EGR 等）が落ちて別構成の行を書き換えてしまう。
 *  2. 同構成の重複行が残っているとき、配信がどれを引くか保証できない → 同じファイルに揃える。
 *  3. 候補の並び順は決定的（orderBy 必須）。
 *  4. .slave の再暗号化キャッシュキーは必ず一意（fileHash 無しを "nohash" で共有しない）。
 *
 * 実行: npx tsx scripts/check-variant-replace.mts
 */
import { readFileSync } from "node:fs";
import {
  sameTagSet,
  normalizeSelectedTags,
  pickReplaceTarget,
  staleDuplicateIds,
  encryptedCacheKey,
} from "../src/server/catalog/variant-config";

let failed = 0;
function ok(cond: boolean, label: string, detail?: string) {
  if (cond) {
    console.log(`  ✓ ${label}`);
  } else {
    failed++;
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
const src = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

console.log("[1] 構成の同定");
ok(sameTagSet(["O2", "DTC"], ["DTC", "O2"]), "順不同で一致する");
ok(!sameTagSet(["O2"], ["O2", "DTC"]), "件数が違えば別構成");
ok(!sameTagSet(["O2", "O2"], ["O2"]), "重複入りの配列は同一視しない（正規化は入口で行う）");

console.log("[2] 選択タグの正規化（落としたら黙って進めない）");
const gasoline = ["NOx", "DTC", "O2", "Flap Open", "バブリング強(触媒無視)", "スピードリミッターカット"];
const n1 = normalizeSelectedTags(["EGR", "O2"], {
  allowed: gasoline,
  pops: false,
  popsStrongTag: "バブリング強(触媒無視)",
});
ok(n1.tags.join(",") === "O2", "許可外タグは tags に入らない");
ok(n1.dropped.join(",") === "EGR", "許可外タグは dropped で返る（呼び出し側が弾ける）");
const n2 = normalizeSelectedTags(["バブリング強(触媒無視)", "O2"], {
  allowed: gasoline,
  pops: false,
  popsStrongTag: "バブリング強(触媒無視)",
});
ok(
  n2.tags.join(",") === "O2" && n2.dropped.length === 0,
  "バブリング無しの『強』は意図的な正規化なので dropped に数えない",
);
const n3 = normalizeSelectedTags(["O2", "O2", "DTC"], {
  allowed: gasoline,
  pops: true,
  popsStrongTag: "バブリング強(触媒無視)",
});
ok(n3.tags.join(",") === "DTC,O2", "重複排除とソートで正規形になる");

console.log("[3] 差し替え先の決定（順序が揺れない）");
const d = (s: string) => new Date(s);
const rows = [
  { id: "b", status: "AVAILABLE" as const, optionTags: [], fileRef: "x", createdAt: d("2026-02-01") },
  { id: "a", status: "AVAILABLE" as const, optionTags: [], fileRef: "y", createdAt: d("2026-01-01") },
  { id: "c", status: "DRAFT" as const, optionTags: [], fileRef: null, createdAt: d("2025-01-01") },
];
ok(pickReplaceTarget(rows)?.id === "a", "配布可＋実体あり＋古い順で決まる");
ok(pickReplaceTarget([...rows].reverse())?.id === "a", "入力順が変わっても同じ行を選ぶ");
ok(pickReplaceTarget([])=== null, "候補が無ければ null（新規作成へ）");
ok(
  staleDuplicateIds(rows, "a").join(",") === "b",
  "揃える対象は配布可の重複のみ（下書き・無効は触らない）",
);

console.log("[4] .slave キャッシュキーの一意性");
const k1 = encryptedCacheKey({ fileHash: null, fileRef: "catalog/tuned/aaa__x.bin" }, "SL1");
const k2 = encryptedCacheKey({ fileHash: null, fileRef: "catalog/tuned/bbb__y.bin" }, "SL1");
ok(k1 !== k2, "fileHash が無い別ファイルは別キーになる");
ok(!k1.includes("nohash"), "\"nohash\" の共有キーを作らない");
ok(
  encryptedCacheKey({ fileHash: "h1", fileRef: "r" }, "SL1") !==
    encryptedCacheKey({ fileHash: "h1", fileRef: "r" }, "SL2"),
  "車(slaveId)が違えば別キー",
);

console.log("[5] 呼び出し側の配線（ソース確認）");
const matrix = src("src/app/hq/records/[id]/variation-matrix.tsx");
ok(
  /name="variantId"\s+value=\{row\.variantId\}/.test(matrix),
  "一覧の差し替えフォームは variantId を送る",
);
const catalogActions = src("src/lib/actions/catalog.ts");
ok(
  catalogActions.includes('const targetIdRaw = formData.get("variantId")'),
  "uploadVariation は variantId を受け取る",
);
ok(
  /差し替え対象のバリエーションが見つかりません/.test(catalogActions),
  "対象が見つからないときは黙って別構成を作らずエラーにする",
);
ok(
  (catalogActions.match(/syncStaleDuplicates\(/g) ?? []).length >= 4,
  "重複を揃える処理が全ての差し替え経路にある（定義＋3経路）",
);
ok(
  !/matched\.find\(\(c\) => c\.status === "AVAILABLE"\) \?\? matched\[0\]/.test(catalogActions),
  "順序不定の find による差し替え先選択が残っていない",
);
const requests = src("src/lib/actions/requests.ts");
ok(
  /status: "AVAILABLE", deletedAt: null \},\s*\n\s*orderBy: \[\{ createdAt: "asc" \}, \{ id: "asc" \}\]/.test(
    requests,
  ),
  "resolveTuning の候補取得に orderBy がある",
);
for (const p of [
  "src/app/api/match/[recordId]/variant/[variantId]/route.ts",
  "src/app/api/catalog/variants/[id]/slave/route.ts",
]) {
  const s = src(p);
  ok(!s.includes('"nohash"'), `${p.split("/").slice(-2).join("/")}: nohash キーを作らない`);
  ok(s.includes("encryptedCacheKey("), `${p.split("/").slice(-2).join("/")}: 共通のキー生成を使う`);
}

console.log(failed === 0 ? "\n✅ すべて通過" : `\n❌ ${failed} 件失敗`);
process.exit(failed === 0 ? 0 : 1);
