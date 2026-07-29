/*
 * 「差し替えたのに差し替わらない」の実データ診断（読み取り専用・DBは一切変更しない）。
 *
 * 見るもの:
 *  A) 同じ構成(ステージ・バブリング・OP集合)で配布可が2行以上あり、現行ファイルが違うもの
 *     → 代理店にどちらが配信されるか保証できない。片方だけ差し替えると古い版が出る。
 *  B) 現行版ポインタ(currentVersion)とキャッシュ列(fileRef)がズレているもの
 *     → 画面と実際の配信内容が食い違う。
 *  C) その純正の選択肢に無いOPを持つ行（燃料を直した後の EGR 等）
 *     → 一覧のチェック列に出ないため、以前は差し替えが別の行に当たっていた。
 *
 * 実行: npx tsx scripts/report-variant-duplicates.mts
 * VPS(本番DB)で見る場合は DATABASE_URL を本番に向けて実行する。
 */
import { prisma } from "../src/lib/db";
import { fuelKindOf, optionTagsFor, tuningContentLabel } from "../src/lib/catalog/options";
import { sameTagSet } from "../src/server/catalog/variant-config";

const variants = await prisma.tunedVariant.findMany({
  where: { deletedAt: null },
  orderBy: [{ baseFileId: "asc" }, { createdAt: "asc" }],
  select: {
    id: true,
    baseFileId: true,
    stage: true,
    popsAndBangs: true,
    popsSport: true,
    optionTags: true,
    status: true,
    fileRef: true,
    fileHash: true,
    fileName: true,
    createdAt: true,
    currentVersion: { select: { version: true, fileRef: true, fileHash: true } },
    baseFile: { select: { model: true, generation: true, calNumber: true, fuel: true, manufacturer: true } },
  },
});

const carOf = (v: (typeof variants)[number]) =>
  [v.baseFile.model, v.baseFile.generation, v.baseFile.calNumber].filter(Boolean).join(" ");

// A) 同構成の重複（配布可）で現行ファイルが違うもの
type Group = { key: string; rows: typeof variants };
const groups = new Map<string, typeof variants>();
for (const v of variants) {
  const key = `${v.baseFileId}|${(v.stage ?? "").trim()}|${v.popsAndBangs}|${v.popsSport}`;
  const arr = groups.get(key) ?? [];
  arr.push(v);
  groups.set(key, arr);
}
const dupGroups: Group[] = [];
for (const [key, rows] of groups) {
  const buckets: (typeof variants)[] = [];
  for (const r of rows) {
    const b = buckets.find((x) => sameTagSet(x[0].optionTags ?? [], r.optionTags ?? []));
    if (b) b.push(r);
    else buckets.push([r]);
  }
  for (const b of buckets) {
    const live = b.filter((r) => r.status === "AVAILABLE" && r.fileRef);
    const hashes = new Set(live.map((r) => r.fileHash ?? r.fileRef));
    if (live.length > 1 && hashes.size > 1) dupGroups.push({ key, rows: b });
  }
}

console.log(`■ A) 同構成で配布可が複数・中身が違う: ${dupGroups.length}件`);
for (const g of dupGroups) {
  const first = g.rows[0];
  console.log(
    `  ${carOf(first)} / ${tuningContentLabel(first.stage, first.popsAndBangs, first.optionTags, first.popsSport)}`,
  );
  for (const r of g.rows) {
    console.log(
      `    - ${r.id} ${r.status} ver${r.currentVersion?.version ?? "?"} ${r.fileName ?? "(名前なし)"} hash=${(r.fileHash ?? "").slice(0, 8)} 作成=${r.createdAt.toISOString().slice(0, 10)}`,
    );
  }
}

// B) 現行版ポインタとキャッシュ列のズレ
const desync = variants.filter(
  (v) => v.currentVersion && v.fileRef && v.currentVersion.fileRef !== v.fileRef,
);
console.log(`\n■ B) 現行版と表示用キャッシュのズレ: ${desync.length}件`);
for (const v of desync) {
  console.log(
    `  ${v.id} ${carOf(v)} / ${tuningContentLabel(v.stage, v.popsAndBangs, v.optionTags, v.popsSport)}`,
  );
  console.log(`    cache=${v.fileRef}\n    current(ver${v.currentVersion?.version})=${v.currentVersion?.fileRef}`);
}

// C) その純正の選択肢に無いOPを持つ行
const extra = variants
  .map((v) => {
    const allowed = new Set(optionTagsFor(fuelKindOf(v.baseFile.fuel), v.baseFile.manufacturer));
    return { v, tags: (v.optionTags ?? []).filter((t) => !allowed.has(t)) };
  })
  .filter((x) => x.tags.length > 0);
console.log(`\n■ C) 選択肢に無いOPを持つ行: ${extra.length}件`);
for (const { v, tags } of extra) {
  console.log(
    `  ${v.id} ${carOf(v)} (${v.baseFile.fuel ?? "燃料未設定"}) / ${tuningContentLabel(v.stage, v.popsAndBangs, v.optionTags, v.popsSport)} → 選択肢外: ${tags.join("・")}`,
  );
}

console.log(
  `\n合計 ${variants.length} 行を確認しました（このスクリプトはDBを変更しません）。` +
    `\nA) は本店で1回差し替えれば同じファイルに揃います。C) は行そのものを狙って差し替わるよう修正済みです。`,
);
await prisma.$disconnect();
