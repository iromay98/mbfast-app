/*
 * 車両ページのWordPress反映（**書き込む**）。必ず先に vpages:wp-diff で確認すること。
 *
 *   npm run vpages:wp-push -- --yes                    … 全対象
 *   npm run vpages:wp-push -- --yes mercedes_gasoline  … ブランドID指定
 *
 * やること:
 *   - 親ページ /tuning/ と /tuning/{brandSlug}/ を slug 照合で用意（無ければ作成）
 *   - wpPageIdJp/En 未設定 → 新規作成して DB に ID を書き戻す
 *   - 設定済み → マーカー区間だけ差し替え（マーカー外の人の追記は保護）
 *   - VehiclePage.status と WP側 status がズレていれば合わせる（draft/publish）
 *   - ENページは Polylang: lang=en + JPページとの translations 紐付け
 *
 * 安全装置:
 *   - --yes が無ければ何も書かない
 *   - <script> 内に生のアンパサンドがあるページはスキップ（REST保存で壊れるため）
 */
import { prisma } from "../src/lib/db";
import { generateVehiclePageEn, generateVehiclePageJp } from "../src/lib/vehicle-pages/generate-html";
import { brandNameEn, brandUrlSlug, resolveVehiclePageData } from "../src/lib/vehicle-pages/resolve";
import {
  createPage,
  ensureParentPage,
  fetchPageRaw,
  findUnsafeScriptContent,
  replaceMarkedRegion,
  updatePage,
  wpConfigured,
} from "../src/lib/vehicle-pages/wp-sync";

if (!wpConfigured()) {
  console.log("✗ WP_USER / WP_APP_PASSWORD が読めていません（vpages:wp-diff と同様、コンテナ内で実行）");
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
  include: { vehicle: { include: { brand: true } } },
  orderBy: { slug: "asc" },
});

if (pages.length === 0) {
  console.log("対象ページがありません（status=hold は対象外）");
  process.exit(0);
}

// ブランド×言語ごとに親ページを1回だけ解決
const parentCache = new Map<string, number>();
async function brandParentId(brandSlug: string, brandName: string, lang: "ja" | "en"): Promise<number> {
  const key = `${lang}:${brandSlug}`;
  const hit = parentCache.get(key);
  if (hit) return hit;
  const title = lang === "en" ? `${brandName} Tuning Data by Model` : `${brandName} 車種別チューニングデータ`;
  const { brandId, created } = await ensureParentPage(brandSlug, title, lang, true);
  if (!brandId) throw new Error(`親ページの用意に失敗: ${lang}/${brandSlug}`);
  for (const c of created) console.log(`  + 親ページ作成: ${c}`);
  parentCache.set(key, brandId);
  return brandId;
}

let created = 0;
let updated = 0;
let skipped = 0;

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
  const wpStatus = p.status === "publish" ? "publish" : "draft";

  // ── JP ──
  const jpBad = findUnsafeScriptContent(jp.html);
  if (jpBad) {
    console.log(`✗ ${p.slug} [JP] スキップ（script内アンパサンド）: ${jpBad}`);
    skipped++;
  } else if (!p.wpPageIdJp) {
    const parent = await brandParentId(brandUrlSlug(b.id, b.slug), b.displayName, "ja");
    const page = await createPage({ slug: p.slug, parent, title: jp.title, content: jp.html, status: wpStatus, lang: "ja" });
    await prisma.vehiclePage.update({ where: { id: p.id }, data: { wpPageIdJp: page.id } });
    p.wpPageIdJp = page.id;
    console.log(`+ ${p.slug} [JP] 作成 page=${page.id} status=${wpStatus}`);
    created++;
  } else {
    const current = await fetchPageRaw(p.wpPageIdJp);
    const { next } = replaceMarkedRegion(current.raw, jp.html);
    const fields: { content?: string; status?: "draft" | "publish" } = {};
    if (next !== current.raw) fields.content = next;
    if (current.status !== wpStatus) fields.status = wpStatus;
    if (Object.keys(fields).length > 0) {
      await updatePage(p.wpPageIdJp, fields);
      console.log(`~ ${p.slug} [JP] 更新 page=${p.wpPageIdJp}${fields.status ? ` status→${wpStatus}` : ""}`);
      updated++;
    } else {
      console.log(`= ${p.slug} [JP] 一致 page=${p.wpPageIdJp}`);
    }
  }

  // ── EN ──（JPページIDが確定してから。translations 紐付けに使う）
  const enBad = findUnsafeScriptContent(en.html);
  if (enBad) {
    console.log(`✗ ${p.slug} [EN] スキップ（script内アンパサンド）: ${enBad}`);
    skipped++;
  } else if (!p.wpPageIdEn) {
    if (!p.wpPageIdJp) {
      console.log(`✗ ${p.slug} [EN] スキップ（JPページ未作成のため紐付け不可）`);
      skipped++;
    } else {
      const parent = await brandParentId(brandUrlSlug(b.id, b.slug), brandNameEn(b.id, b.displayName), "en");
      const page = await createPage({
        slug: p.slug,
        parent,
        title: en.title,
        content: en.html,
        status: wpStatus,
        lang: "en",
        translationOfJp: p.wpPageIdJp,
      });
      await prisma.vehiclePage.update({ where: { id: p.id }, data: { wpPageIdEn: page.id } });
      console.log(`+ ${p.slug} [EN] 作成 page=${page.id} status=${wpStatus}`);
      created++;
    }
  } else {
    const current = await fetchPageRaw(p.wpPageIdEn);
    const { next } = replaceMarkedRegion(current.raw, en.html);
    const fields: { content?: string; status?: "draft" | "publish" } = {};
    if (next !== current.raw) fields.content = next;
    if (current.status !== wpStatus) fields.status = wpStatus;
    if (Object.keys(fields).length > 0) {
      await updatePage(p.wpPageIdEn, fields);
      console.log(`~ ${p.slug} [EN] 更新 page=${p.wpPageIdEn}${fields.status ? ` status→${wpStatus}` : ""}`);
      updated++;
    } else {
      console.log(`= ${p.slug} [EN] 一致 page=${p.wpPageIdEn}`);
    }
  }
}

console.log("");
console.log(`作成: ${created} / 更新: ${updated} / スキップ: ${skipped}`);
