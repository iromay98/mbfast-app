/*
 * 価格表をWordPress本番へ反映する（**書き込む**）。
 *
 *   npm run prices:wp-push -- --yes             … 列順が一致しているブランドだけ反映
 *   npm run prices:wp-push -- --yes ferrari     … ブランド指定
 *   npm run prices:wp-push -- --yes --force ferrari
 *        列順が本番と違っても書き込む。**手作業の並び替えを上書きするので、
 *        差分レポートで内容を確認し、意図した変更だと分かっているときだけ**。
 *
 * 先に npm run prices:wp-diff で一致を確認すること。--yes が無ければ何もしない。
 */
import { prisma } from "../src/lib/db";
import { generatePriceTableHtml } from "../src/lib/prices/generate-html";
import { diffBrandPage, applyBrandPage } from "../src/lib/prices/wp-sync";
import { wpConfigured } from "../src/lib/prices/wordpress";
import type { BrandRow, VehicleRow } from "../src/lib/prices/types";

const args = process.argv.slice(2);
const yes = args.includes("--yes");
const force = args.includes("--force");
const only = args.filter((a) => !a.startsWith("-"));

if (!wpConfigured()) {
  console.log("✗ WP_USER / WP_APP_PASSWORD が未設定です（.env）");
  process.exit(1);
}
if (!yes) {
  console.log("何もしていません。書き込むには --yes を付けてください。");
  console.log("  先に差分を確認: npm run prices:wp-diff");
  process.exit(1);
}
if (force) {
  console.log("⚠ --force: 列順が本番と違っても上書きします（手作業の並びが消える可能性があります）");
}

const brands = await prisma.priceBrand.findMany({
  where: only.length ? { id: { in: only } } : undefined,
  orderBy: { displayOrder: "asc" },
});

let applied = 0;
let skipped = 0;
let failed = 0;
for (const b of brands) {
  const vehicles = await prisma.priceVehicle.findMany({
    where: { brandId: b.id },
    // 並び順は generatePriceTableHtml 内の sortVehiclesForDisplay が最終的に決める。
    // ここはDBの取得順を固定するだけ（verify-price-html と同じ displayOrder）。
    orderBy: { displayOrder: "asc" },
  });
  let nextHtml: string;
  try {
    nextHtml = generatePriceTableHtml(b as unknown as BrandRow, vehicles as unknown as VehicleRow[]);
  } catch (e) {
    failed++;
    console.log(`✗ ${b.id}: 生成に失敗 — ${e instanceof Error ? e.message : String(e)}`);
    continue;
  }
  try {
    const d = await diffBrandPage({
      brandId: b.id,
      displayName: b.displayName,
      pageId: b.wordPressPageId,
      nextHtml,
    });
    const r = await applyBrandPage(d, nextHtml, { force });
    if (r.ok) {
      applied++;
      console.log(`✓ ${b.id}: 反映しました（${d.next.rows}行 / ${d.next.bytes}B）`);
    } else if (r.error) {
      failed++;
      console.log(`✗ ${b.id}: ${r.error}`);
    } else {
      skipped++;
      console.log(`－ ${b.id}: ${r.skipped}`);
    }
  } catch (e) {
    failed++;
    console.log(`✗ ${b.id}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

console.log("");
console.log(`反映 ${applied}件 / 見送り ${skipped}件 / 失敗 ${failed}件`);
await prisma.$disconnect();
process.exit(failed > 0 ? 1 : 0);
