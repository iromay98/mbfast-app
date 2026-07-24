/*
 * Step A: WordPress固定ページから価格表HTML（content.raw）を取得して保存する。
 *   保存先: prisma/data/wp-live/{slug}.html（content.raw 全体）
 * 認証: WP_USER / WP_APP_PASSWORD（.env のみ。コミット禁止）
 *
 * 使い方: DATABASE_URL不要。 set -a && . ./.env && set +a && tsx scripts/price-sync/fetch-wp.mts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const outDir = join(root, "prisma", "data", "wp-live");
mkdirSync(outDir, { recursive: true });

const BASE = process.env.WP_BASE_URL ?? "https://mbfasttuning.com";
const user = process.env.WP_USER;
const pass = process.env.WP_APP_PASSWORD;
if (!user || !pass) throw new Error("WP_USER / WP_APP_PASSWORD が未設定です");
const auth = `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;

// ソースA: 静的HTML済み4ページ
const PAGES = [
  { brand: "bmw", pageId: 9614 },
  { brand: "mercedes-benz", pageId: 9679 }, // ガソリン+ディーゼル同居
  { brand: "audi", pageId: 9605 },
  { brand: "lamborghini", pageId: 9668 },
];

for (const p of PAGES) {
  const url = `${BASE}/wp-json/wp/v2/pages/${p.pageId}?context=edit&_fields=id,slug,content.raw`;
  const res = await fetch(url, { headers: { Authorization: auth } });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`${p.brand}(page ${p.pageId}): HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { id: number; slug: string; content: { raw: string } };
  const raw = data.content.raw;
  writeFileSync(join(outDir, `${p.brand}.html`), raw);
  console.log(`${p.brand.padEnd(16)} page=${data.id} slug=${data.slug} bytes=${raw.length}`);
}
console.log("\n保存先: prisma/data/wp-live/");
