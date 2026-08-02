/*
 * mbPITとして見せるページが、ホーム画面でmbFASTのアイコン・名前にならないことを検査する。
 *
 * なぜ必要か: ルートlayoutのmetadataはmbFAST（manifest.webmanifest / appleWebApp.title="mbFAST"）で、
 * 各ページが明示的に上書きしないと**そのまま継承**する。上書き忘れは画面を見ても気づきにくく、
 * 「ホーム画面に追加したときだけmbFASTのアイコンになる」形で表に出る。
 * 実際に /pit/join・/pit/terms・/mycar が漏れていた。
 *
 * 検査対象: mbPITブランドで見せるページ（加盟店・お客様向け）。
 * 判定: そのページ（またはその配下を覆うlayout）が PIT_APP_ICONS / pitMetadata /
 *       publicCertMetadata のいずれかを使っていること。
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";

const APP = join(process.cwd(), "src", "app");

/** mbPITブランドで見せる範囲（ここに入るページはmbFASTを継承してはいけない） */
const PIT_ROUTES = [
  "dealer/pit", // 加盟店ポータル
  "pit", // 公開の加盟店登録・利用規約
  "mycar", // お客様のマイカーページ
  "cert", // 施工証明書の共有ページ
  "verify", // 施工証明書の検証ページ
];

const MARKERS = ["PIT_APP_ICONS", "pitMetadata(", "publicCertMetadata("];

function pages(dir: string): string[] {
  const out: string[] = [];
  if (!existsSync(dir)) return out;
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) out.push(...pages(p));
    else if (e === "page.tsx") out.push(p);
  }
  return out;
}

/*
 * リダイレクトするだけのページは画面を描画しないので対象外。
 * （例: 旧・招待URLの後方互換ページ。metadataを付けても意味が無い）
 * JSXを返さず redirect() だけを呼ぶものを「描画しない」と判定する。
 */
function isRedirectOnly(src: string): boolean {
  const hasRedirect = /\bredirect\s*\(/.test(src);
  const hasJsx = /return\s*\(?\s*</.test(src);
  return hasRedirect && !hasJsx;
}

/** そのページ自身か、上位のlayoutのどれかがmbPIT指定を持っているか */
function covered(pagePath: string): boolean {
  let dir = dirname(pagePath);
  const self = readFileSync(pagePath, "utf-8");
  if (MARKERS.some((m) => self.includes(m))) return true;
  // 上位layoutを app ディレクトリまで遡る
  for (;;) {
    const layout = join(dir, "layout.tsx");
    if (existsSync(layout)) {
      const s = readFileSync(layout, "utf-8");
      if (MARKERS.some((m) => s.includes(m))) return true;
    }
    if (dir === APP || !dir.startsWith(APP)) break;
    dir = dirname(dir);
  }
  return false;
}

let failed = 0;
let checked = 0;
console.log("mbPITブランドのページがmbFASTを継承していないか検査");
console.log("");
for (const route of PIT_ROUTES) {
  for (const p of pages(join(APP, route))) {
    const rel = p.slice(APP.length + 1);
    if (isRedirectOnly(readFileSync(p, "utf-8"))) {
      console.log(`  −  ${rel}（リダイレクトのみ・対象外）`);
      continue;
    }
    checked++;
    if (covered(p)) {
      console.log(`  ✅ ${rel}`);
    } else {
      console.log(`  ❌ ${rel}  ← mbFASTのアイコン/名前を継承している`);
      failed++;
    }
  }
}

console.log("");
console.log(`対象 ${checked} ページ`);
if (failed) {
  console.error(
    `${failed} ページがmbPIT指定を持っていません。` +
      "pitMetadata() / publicCertMetadata() を使うか、metadata に ...PIT_APP_ICONS を混ぜてください" +
      "（クライアントコンポーネントのページは同階層に layout.tsx を作って指定する）。",
  );
  process.exit(1);
}
console.log("全ページがmbPITブランドで表示されます");
