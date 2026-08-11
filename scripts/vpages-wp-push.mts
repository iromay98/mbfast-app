/*
 * 車両ページのWordPress反映（**書き込む**）。必ず先に vpages:wp-diff で確認すること。
 *
 *   npm run vpages:wp-push -- --yes                    … 全対象（status=draft/publish）
 *   npm run vpages:wp-push -- --yes mb lambo           … ブランドID指定
 *
 * 実処理は src/lib/vehicle-pages/sync-core.ts（管理画面 /hq/vehicle-pages と共通）。
 * 安全装置: --yes が無ければ何も書かない。
 */
import { prisma } from "../src/lib/db";
import { syncVehiclePage } from "../src/lib/vehicle-pages/sync-core";
import { wpConfigured } from "../src/lib/vehicle-pages/wp-sync";

if (!wpConfigured()) {
  console.log("✗ WP_USER / WP_APP_PASSWORD が読めていません（コンテナ内で実行してください）");
  process.exit(1);
}

const args = process.argv.slice(2);
if (!args.includes("--yes")) {
  console.log("✗ 書き込みには --yes が必要です: npm run vpages:wp-push -- --yes");
  process.exit(1);
}
const only = args.filter((a) => !a.startsWith("-"));

const pages = await prisma.vehiclePage.findMany({
  where: {
    status: { in: ["draft", "publish"] },
    ...(only.length ? { vehicle: { brandId: { in: only } } } : {}),
  },
  select: { id: true, slug: true },
  orderBy: { slug: "asc" },
});

if (pages.length === 0) {
  console.log("対象ページがありません（status=hold は対象外）");
  process.exit(0);
}

let errors = 0;
for (const p of pages) {
  const events = await syncVehiclePage(p.id);
  for (const e of events) {
    if (e.level === "error") errors++;
    console.log(`${e.level === "error" ? "✗" : e.level === "warn" ? "!" : "・"} ${p.slug} ${e.message}`);
  }
}
console.log("");
console.log(errors > 0 ? `完了（エラー ${errors} 件）` : "完了");
