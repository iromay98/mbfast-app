/*
 * 価格表とWordPress本番の差分レポート（**書き込まない**）。
 *
 *   npm run prices:wp-diff            … 全ブランド
 *   npm run prices:wp-diff -- ferrari … ブランドIDを指定
 *
 * 見るところ:
 *   - 列順（thead）が本番と一致しているか。ここが違うと、同期は手作業の並び替えを巻き戻す
 *   - 行数・バイト数の差
 *   - REST保存で壊れる内容（<script> 内のアンパサンド）が無いか
 *
 * 書き込みは npm run prices:wp-push（--yes 必須）。先にこのレポートで一致を確認すること。
 */
import { prisma } from "../src/lib/db";
import { generatePriceTableHtml } from "../src/lib/prices/generate-html";
import { diffBrandPage, type BrandDiff } from "../src/lib/prices/wp-sync";
import { wpConfigured } from "../src/lib/prices/wordpress";
import type { BrandRow, VehicleRow } from "../src/lib/prices/types";

if (!wpConfigured()) {
  console.log("✗ WP_USER / WP_APP_PASSWORD が未設定です（.env）");
  process.exit(1);
}

const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));

const brands = await prisma.priceBrand.findMany({
  where: only.length ? { id: { in: only } } : undefined,
  orderBy: { displayOrder: "asc" },
});
if (brands.length === 0) {
  console.log("✗ 対象ブランドがありません");
  process.exit(1);
}

const diffs: BrandDiff[] = [];
for (const b of brands) {
  const vehicles = await prisma.priceVehicle.findMany({
    where: { brandId: b.id },
    // 並び順は generatePriceTableHtml 内の sortVehiclesForDisplay が最終的に決める。
    // ここはDBの取得順を固定するだけ（verify-price-html と同じ displayOrder）。
    orderBy: { displayOrder: "asc" },
  });
  let nextHtml = "";
  try {
    nextHtml = generatePriceTableHtml(b as unknown as BrandRow, vehicles as unknown as VehicleRow[]);
  } catch (e) {
    console.log(`■ ${b.id} (${b.displayName})`);
    console.log(`   ✗ 生成に失敗: ${e instanceof Error ? e.message : String(e)}`);
    continue;
  }
  let d: BrandDiff;
  try {
    d = await diffBrandPage({
      brandId: b.id,
      displayName: b.displayName,
      pageId: b.wordPressPageId,
      nextHtml,
    });
  } catch (e) {
    console.log(`■ ${b.id} (${b.displayName})`);
    console.log(`   ✗ 本番の取得に失敗: ${e instanceof Error ? e.message : String(e)}`);
    continue;
  }
  diffs.push(d);

  console.log(`■ ${d.brandId} (${d.displayName})  page=${d.pageId ?? "未設定"}`);
  if (d.skipped) {
    console.log(`   － ${d.skipped}`);
    continue;
  }
  if (!d.restSafe) console.log(`   ✗ ${d.restSafeReason}`);
  if (d.identical) {
    console.log("   ✓ 差分なし（本番と完全一致）");
    continue;
  }
  console.log(`   行数: 本番 ${d.live.rows} → 生成 ${d.next.rows}`);
  console.log(`   容量: 本番 ${d.live.bytes}B → 生成 ${d.next.bytes}B`);
  if (d.headersMatch) {
    console.log(`   ✓ 列順は一致（${d.next.headers.length}列）`);
  } else {
    console.log("   ✗ 列順が一致しません");
    console.log(`     本番: ${d.live.headers.join(" | ") || "(theadが取れませんでした)"}`);
    console.log(`     生成: ${d.next.headers.join(" | ")}`);
    // 工賃列がどこに居るかを名指しする（今回の負債の核心）
    const laborRe = /工賃/;
    const li = d.live.headers.findIndex((h) => laborRe.test(h));
    const ni = d.next.headers.findIndex((h) => laborRe.test(h));
    if (li !== ni) {
      console.log(
        `     工賃列の位置: 本番 ${li === -1 ? "なし" : `${li + 1}列目`} / 生成 ${ni === -1 ? "なし" : `${ni + 1}列目`}`,
      );
    }
  }
}

const blocked = diffs.filter((d) => !d.skipped && !d.identical && (!d.headersMatch || !d.restSafe));
const writable = diffs.filter((d) => !d.skipped && !d.identical && d.headersMatch && d.restSafe);
console.log("");
console.log(`同期できる（列順一致・差分あり）: ${writable.length}件`);
console.log(`要修正（列順不一致 or REST非安全）: ${blocked.length}件`);
if (blocked.length > 0) {
  console.log(`  → ${blocked.map((d) => d.brandId).join(", ")}`);
  console.log("  この状態で push すると本番の手作業を巻き戻します。先に生成側を直してください。");
}
console.log("");
console.log("※ このコマンドは本番に書き込みません。書き込みは npm run prices:wp-push -- --yes");
await prisma.$disconnect();
process.exit(blocked.length > 0 ? 1 : 0);
