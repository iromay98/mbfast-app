/*
 * Step A: WordPress固定ページから価格表HTML（content.raw）を取得して保存する。
 *   保存先: prisma/data/wp-live/{pageId}.html（content.raw 全体・兄弟ブロック込み）
 * 認証: WP_USER / WP_APP_PASSWORD（.env のみ。コミット禁止）
 *
 * 使い方（VPSの本番/開発クローンで実行。DATABASE_URL不要）:
 *   set -a && . /root/mbfast-app/.env && set +a && tsx scripts/price-sync/fetch-wp.mts
 *   （WP認証を持つ環境で。取得後 prisma/data/wp-live/ を commit すればCIで使える）
 *
 * pageId をファイル名の主キーにする理由:
 *   Mercedes(9679)は1ページに mb(ガソリン,block0) と mbd(ディーゼル,block2) が同居。
 *   slug で分けると同居ページを取りこぼすため、pageId 単位で content.raw 全文を保存する。
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
if (!user || !pass) throw new Error("WP_USER / WP_APP_PASSWORD が未設定です（.env を読み込んでから実行してください）");
const auth = `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;

// spec §1.1 の27テーブル / 26ページ。pageId で一意化（9679 は mb+mbd 同居）。
const PAGES: { pageId: number; prefixes: string[] }[] = [
  { pageId: 9614, prefixes: ["bmw"] },
  { pageId: 9679, prefixes: ["mb", "mbd"] }, // ガソリン(block0)+ディーゼル(block2)
  { pageId: 9605, prefixes: ["audi"] },
  { pageId: 9684, prefixes: ["porsche"] },
  { pageId: 9688, prefixes: ["vw"] },
  { pageId: 11294, prefixes: ["alfa"] },
  { pageId: 11024, prefixes: ["cdj"] },
  { pageId: 12347, prefixes: ["abarth"] },
  { pageId: 9671, prefixes: ["landrover"] },
  { pageId: 9666, prefixes: ["jaguar"] },
  { pageId: 9675, prefixes: ["maserati"] },
  { pageId: 14154, prefixes: ["mini"] },
  { pageId: 9686, prefixes: ["toyota"] },
  { pageId: 12445, prefixes: ["aston"] },
  { pageId: 9616, prefixes: ["ferrari"] },
  { pageId: 9673, prefixes: ["lexus"] },
  { pageId: 9668, prefixes: ["lambo"] },
  { pageId: 13721, prefixes: ["chevrolet"] },
  { pageId: 15852, prefixes: ["mclaren"] },
  { pageId: 13593, prefixes: ["ford"] },
  { pageId: 9682, prefixes: ["nissan"] },
  { pageId: 10109, prefixes: ["suzuki"] },
  { pageId: 3463, prefixes: ["honda"] },
  { pageId: 14874, prefixes: ["fuso"] },
  { pageId: 9691, prefixes: ["others"] },
  { pageId: 15302, prefixes: ["daihatsu"] },
];

// wp:html ブロック数のざっくり計測（兄弟ブロック保持の検証対象を把握するため）
function countHtmlBlocks(raw: string): number {
  const m = raw.match(/<!--\s*wp:html\s*-->/g);
  return m ? m.length : 0;
}

const ok: string[] = [];
const failed: { pageId: number; reason: string }[] = [];

for (const p of PAGES) {
  const label = p.prefixes.join("/");
  const url = `${BASE}/wp-json/wp/v2/pages/${p.pageId}?context=edit&_fields=id,slug,content.raw`;
  try {
    const res = await fetch(url, { headers: { Authorization: auth } });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      failed.push({ pageId: p.pageId, reason: `HTTP ${res.status} ${body.slice(0, 160)}` });
      console.log(`✗ ${label.padEnd(14)} page=${p.pageId} HTTP ${res.status}`);
      continue;
    }
    const data = (await res.json()) as { id: number; slug: string; content: { raw: string } };
    const raw = data.content?.raw ?? "";
    if (!raw) {
      failed.push({ pageId: p.pageId, reason: "content.raw が空（context=edit の権限/認証を確認）" });
      console.log(`✗ ${label.padEnd(14)} page=${p.pageId} content.raw 空`);
      continue;
    }
    writeFileSync(join(outDir, `${p.pageId}.html`), raw);
    ok.push(`${p.pageId}.html`);
    console.log(
      `✓ ${label.padEnd(14)} page=${data.id} slug=${(data.slug ?? "").padEnd(18)} bytes=${String(raw.length).padStart(7)} wp:htmlブロック=${countHtmlBlocks(raw)}`,
    );
  } catch (e) {
    failed.push({ pageId: p.pageId, reason: e instanceof Error ? e.message : String(e) });
    console.log(`✗ ${label.padEnd(14)} page=${p.pageId} ${e instanceof Error ? e.message : String(e)}`);
  }
}

console.log("");
console.log(`取得成功 ${ok.length} / ${PAGES.length} ページ（保存先: prisma/data/wp-live/）`);
if (failed.length > 0) {
  console.log(`取得失敗 ${failed.length} 件:`);
  for (const f of failed) console.log(`  - page ${f.pageId}: ${f.reason}`);
  process.exit(1);
}
