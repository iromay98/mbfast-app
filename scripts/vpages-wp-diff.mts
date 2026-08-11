/*
 * 車両ページとWordPress本番の差分レポート（**書き込まない**）。
 *
 *   npm run vpages:wp-diff                    … status が draft/publish の全ページ
 *   npm run vpages:wp-diff -- mercedes_gasoline … ブランドID指定
 *
 * 見るところ:
 *   - 新規作成になるページ（wpPageIdJp/En が未設定）と、更新になるページ
 *   - 更新側: マーカー区間の有無・バイト差
 *   - REST保存で壊れる内容（<script> 内の生アンパサンド）が無いか
 *
 * 書き込みは npm run vpages:wp-push（--yes 必須）。
 */
import { prisma } from "../src/lib/db";
import { generateVehiclePageEn, generateVehiclePageJp } from "../src/lib/vehicle-pages/generate-html";
import { resolveVehiclePageData } from "../src/lib/vehicle-pages/resolve";
import { fetchPageRaw, findUnsafeScriptContent, replaceMarkedRegion, wpConfigured } from "../src/lib/vehicle-pages/wp-sync";

if (!wpConfigured()) {
  console.log("✗ WP_USER / WP_APP_PASSWORD が読めていません");
  console.log("→ アプリのコンテナの中で実行してください:");
  console.log("   docker compose -f /root/mbfast-app/docker-compose.prod.yml exec app npm run vpages:wp-diff");
  process.exit(1);
}

const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));

const pages = await prisma.vehiclePage.findMany({
  where: {
    status: { in: ["draft", "publish"] },
    ...(only.length ? { vehicle: { brandId: { in: only } } } : {}),
  },
  include: { vehicle: { include: { brand: true } } },
  orderBy: { slug: "asc" },
});

if (pages.length === 0) {
  console.log("対象ページがありません（status=hold は対象外）");
  process.exit(0);
}

let creates = 0;
let updates = 0;
let unsafe = 0;

for (const p of pages) {
  const v = p.vehicle;
  const b = v.brand;
  const vehicleEn =
    p.enPriceMode === "price"
      ? await prisma.priceVehicle.findFirst({
          where: { brandId: b.id, market: "EN", carName: v.carName, grade: v.grade },
        })
      : null;
  const data = resolveVehiclePageData(b, v, p, vehicleEn);
  const jp = generateVehiclePageJp(data);
  const en = generateVehiclePageEn(data);

  for (const [label, gen, wpId] of [
    ["JP", jp, p.wpPageIdJp],
    ["EN", en, p.wpPageIdEn],
  ] as const) {
    const bad = findUnsafeScriptContent(gen.html);
    if (bad) {
      console.log(`✗ ${p.slug} [${label}] script内に生のアンパサンド: ${bad}`);
      unsafe++;
      continue;
    }
    if (!wpId) {
      console.log(`+ ${p.slug} [${label}] 新規作成（/tuning/${b.slug}/${p.slug}/ status=${p.status}）`);
      creates++;
    } else {
      const current = await fetchPageRaw(wpId);
      const { next, hadRegion } = replaceMarkedRegion(current.raw, gen.html);
      const changed = next !== current.raw;
      console.log(
        `${changed ? "~" : "="} ${p.slug} [${label}] page=${wpId} ${hadRegion ? "" : "(マーカー無し→全文差替)"} ${changed ? `${current.raw.length} → ${next.length} bytes` : "一致"}`,
      );
      if (changed) updates++;
    }
  }
}

console.log("");
console.log(`新規: ${creates} / 更新: ${updates} / 危険な内容: ${unsafe}`);
if (unsafe > 0) process.exit(1);
