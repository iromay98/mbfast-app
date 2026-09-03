// 車両ページの一括再反映をコマンドラインから実行する(GitHub Actions経由の遠隔実行用)。
// 使い方: npm run vpages:resync -- mb lambo   (引数はブランドのid or slug。"all"で全ブランド)
// HQ画面の「全ページを再反映」と同じ順序: JP商品 → ページHTML → ブランドハブ → ルートハブ。
import { prisma } from "../src/lib/db";
import { syncVehiclePage } from "../src/lib/vehicle-pages/sync-core";
import { syncBrandHub, syncRootHub } from "../src/lib/vehicle-pages/hub-sync";
import { syncJpProductsForBrand } from "../src/lib/vehicle-pages/woo-jp";

async function main() {
  const args = process.argv.slice(2).filter(Boolean);
  if (args.length === 0) {
    console.error("ブランドを指定してください(id/slug、複数可。all=全ブランド)");
    process.exit(1);
  }
  const brands = await prisma.priceBrand.findMany({ select: { id: true, slug: true, displayName: true } });
  const targets = args.includes("all")
    ? brands
    : brands.filter((b) => args.includes(b.id) || args.includes(b.slug));
  if (targets.length === 0) {
    console.error("該当ブランドなし。指定:", args.join(","), "| 存在:", brands.map((b) => b.id).join(","));
    process.exit(1);
  }
  for (const b of targets) {
    console.log(`=== ${b.displayName} (${b.id}) ===`);
    try {
      await syncJpProductsForBrand(b.id);
      console.log("JP商品: 同期完了");
    } catch (e) {
      console.log("JP商品: 失敗(続行)", e instanceof Error ? e.message.slice(0, 100) : "");
    }
    const pages = await prisma.vehiclePage.findMany({
      where: { vehicle: { brandId: b.id }, status: { in: ["draft", "publish"] } },
      select: { id: true, slug: true },
      orderBy: { slug: "asc" },
    });
    let ok = 0;
    let ng = 0;
    for (const p of pages) {
      try {
        const events = await syncVehiclePage(p.id);
        const err = events.find((e) => e.level === "error");
        if (err) {
          ng++;
          console.log(`  NG ${p.slug}: ${err.message.slice(0, 90)}`);
        } else ok++;
      } catch (e) {
        ng++;
        console.log(`  NG ${p.slug}: ${e instanceof Error ? e.message.slice(0, 90) : "?"}`);
      }
    }
    console.log(`ページ: 成功${ok} / 失敗${ng}`);
    try {
      await syncBrandHub(b.id);
      console.log("ハブ: 更新完了");
    } catch {
      console.log("ハブ: 失敗(HQ画面から再実行可)");
    }
  }
  try {
    await syncRootHub();
    console.log("ルートハブ: 更新完了");
  } catch {
    console.log("ルートハブ: 失敗");
  }
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
