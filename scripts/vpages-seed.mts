/*
 * PriceVehicle（market=JP）から VehiclePage の行を用意する（既定ドライラン）。
 *
 *   npm run vpages:seed -- mercedes_gasoline            … ドライラン（何が作られるか表示のみ）
 *   npm run vpages:seed -- mercedes_gasoline --commit   … 作成（status=hold で作る＝公開はしない）
 *
 * ルール:
 *   - status は必ず hold で作る。draft/publish への昇格は人が /hq またはDBで行う
 *   - slug は carName+grade から生成。衝突したら連番を付けて必ず一意にする
 *   - 既に VehiclePage がある車両はスキップ（冪等）
 */
import { prisma } from "../src/lib/db";
import { vehicleSlug } from "../src/lib/vehicle-pages/resolve";
import { seedVehiclePagesForBrand } from "../src/lib/vehicle-pages/seed";

const args = process.argv.slice(2);
const commit = args.includes("--commit");
const brandIds = args.filter((a) => !a.startsWith("-"));

if (brandIds.length === 0) {
  console.log("✗ ブランドIDを指定してください（例: npm run vpages:seed -- mercedes_gasoline lamborghini）");
  process.exit(1);
}

const vehicles = await prisma.priceVehicle.findMany({
  where: { brandId: { in: brandIds }, market: "JP", page: null },
  orderBy: [{ brandId: "asc" }, { displayOrder: "asc" }],
});

if (vehicles.length === 0) {
  console.log("対象がありません（全車両にページ行が既にあるか、ブランドIDが違います）");
  process.exit(0);
}

const existing = new Set((await prisma.vehiclePage.findMany({ select: { slug: true } })).map((p) => p.slug));

let planned = 0;
for (const v of vehicles) {
  let slug = vehicleSlug(v.carName, v.grade);
  if (!slug) {
    console.log(`✗ slug化できません: ${v.carName} ${v.grade ?? ""}`);
    continue;
  }
  let n = 2;
  while (existing.has(slug)) slug = `${vehicleSlug(v.carName, v.grade)}-${n++}`;
  existing.add(slug);
  planned++;
  console.log(`${commit ? "+" : "（予定）"} ${v.brandId} ${v.carName} ${v.grade ?? ""} → /${slug}/`);
}
if (commit) {
  for (const brandId of brandIds) await seedVehiclePagesForBrand(brandId);
}

console.log("");
console.log(commit ? `作成: ${planned} 行（全て status=hold）` : `ドライラン: ${planned} 行が作成対象。--commit で作成`);
