/*
 * Step D: WPページの Airtable iframe を生成HTMLに置換する。
 *  - wp:html ブロック内の airtable iframe「のみ」を置換（段落・注記等はそのまま）
 *  - 置換前の content.raw 全文を prisma/data/wp-backup/ と PriceSyncLog(backup) に保存
 *  - daihatsu（15302）はスコープ外（このスクリプトはブランドIDベースなので触れない）
 *
 * 使い方: set -a && . ./.env && set +a && tsx scripts/price-sync/replace-iframe.mts <brandId...> [--dry-run]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { Client } from "pg";
import { generatePriceTableHtml } from "../../src/lib/prices/generate-html";
import { normalizeEntities, parseWpHtmlBlocks } from "../../src/lib/prices/wp-blocks";
import { toColumns, toPrices, toRemote, type BrandRow, type VehicleRow } from "../../src/lib/prices/types";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const backupDir = join(root, "prisma", "data", "wp-backup");
mkdirSync(backupDir, { recursive: true });

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const ids = args.filter((a) => a !== "--dry-run");
if (ids.length === 0) throw new Error("brandId を指定してください");

const BASE = process.env.WP_BASE_URL ?? "https://mbfasttuning.com";
const auth = `Basic ${Buffer.from(`${process.env.WP_USER}:${process.env.WP_APP_PASSWORD}`).toString("base64")}`;
const IFRAME_RE = /<iframe[^>]*airtable\.com\/embed[^>]*>\s*<\/iframe>|<iframe[^>]*airtable\.com\/embed[^>]*\/>/;

const c = new Client({ connectionString: process.env.DATABASE_URL!.replace(/\?schema=public$/, "") });
await c.connect();

for (const id of ids) {
  const b = (await c.query(`SELECT * FROM "PriceBrand" WHERE id=$1`, [id])).rows[0];
  if (!b) throw new Error(`ブランドが見つかりません: ${id}`);
  if (!b.wordPressPageId) throw new Error(`${id}: wordPressPageId 未設定`);
  if (b.wordPressPageId === 15302) throw new Error("daihatsu(15302) はスコープ外です");

  const brand: BrandRow = {
    id: b.id, displayName: b.displayName, slug: b.slug, namespacePrefix: b.namespacePrefix,
    seriesGroups: b.seriesGroups, columns: toColumns(b.columns), intro: b.intro ?? "",
    jsonLdDescription: b.jsonLdDescription ?? "", wordPressPageId: b.wordPressPageId, vehicleCount: 0,
  };
  const vs = (await c.query(`SELECT * FROM "PriceVehicle" WHERE "brandId"=$1 AND market='JP' ORDER BY "displayOrder"`, [id])).rows;
  const vehicles: VehicleRow[] = vs.map((v) => ({
    id: v.id, seriesGroup: v.seriesGroup, carName: v.carName, grade: v.grade, engine: v.engine,
    engineFamily: v.engineFamily, ecuType: v.ecuType, stockOutput: v.stockOutput, stage1Gain: v.stage1Gain,
    prices: toPrices(v.prices), labor: v.labor, shops: v.shops, remote: toRemote(v.remote),
    notes: v.notes, displayOrder: v.displayOrder,
  }));
  const html = generatePriceTableHtml(brand, vehicles);

  const pageId: number = b.wordPressPageId;
  const res = await fetch(`${BASE}/wp-json/wp/v2/pages/${pageId}?context=edit&_fields=id,slug,content.raw`, { headers: { Authorization: auth } });
  if (!res.ok) throw new Error(`${id}: ページ取得 HTTP ${res.status}`);
  const page = (await res.json()) as { id: number; slug: string; content: { raw: string } };
  const raw = page.content.raw;

  if (normalizeEntities(raw).includes(`class="${b.namespacePrefix}price-wrapper"`)) {
    console.log(`⏭️  ${id}(page ${pageId}): 既にHTML化済み — スキップ（更新は同期エンジンで）`);
    continue;
  }

  const blocks = parseWpHtmlBlocks(raw);
  const target = blocks.find((bl) => IFRAME_RE.test(bl.inner));
  if (!target) throw new Error(`${id}(page ${pageId}): airtable iframe を含む wp:html ブロックが見つかりません`);

  const m = IFRAME_RE.exec(target.inner)!;
  const newInner = target.inner.slice(0, m.index) + html.trim() + target.inner.slice(m.index + m[0].length);
  const newContent = raw.slice(0, target.innerStart) + newInner + raw.slice(target.innerEnd);

  console.log(`${dryRun ? "[dry-run] " : ""}${id}(page ${pageId} /${page.slug}): iframe(${m[0].length}B) → HTML(${html.length}B) / ${vehicles.length}行`);
  if (dryRun) continue;

  // バックアップ（ファイル＋PriceSyncLog）→ 更新
  writeFileSync(join(backupDir, `${page.slug}-${pageId}.html`), raw);
  const hash = createHash("sha256").update(normalizeEntities(html)).digest("hex");
  const upd = await fetch(`${BASE}/wp-json/wp/v2/pages/${pageId}`, {
    method: "POST",
    headers: { Authorization: auth, "Content-Type": "application/json" },
    body: JSON.stringify({ content: newContent }),
  });
  if (!upd.ok) {
    const body = await upd.text().catch(() => "");
    await c.query(
      `INSERT INTO "PriceSyncLog" (id, "wpPageId", "brandIds", "payloadHash", status, error) VALUES (gen_random_uuid()::text, $1, $2, $3, 'failed', $4)`,
      [pageId, [id], hash, `iframe置換失敗: HTTP ${upd.status} ${body.slice(0, 200)}`],
    );
    throw new Error(`${id}: 更新失敗 HTTP ${upd.status}（WPはWordPress側でエラーのため未変更の可能性が高い）`);
  }
  await c.query(
    `INSERT INTO "PriceSyncLog" (id, "wpPageId", "brandIds", "payloadHash", status, backup) VALUES (gen_random_uuid()::text, $1, $2, $3, 'success', $4)`,
    [pageId, [id], hash, raw],
  );
  console.log(`✅ ${id}: 置換完了（バックアップ: prisma/data/wp-backup/${page.slug}-${pageId}.html ＋ PriceSyncLog）`);
}
await c.end();
