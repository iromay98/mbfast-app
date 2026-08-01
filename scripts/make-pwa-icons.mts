/*
 * ホーム画面（PWA）アイコンを生成する。
 *
 * なぜ必要か: mbPITは**mbFASTとは別ブランド**として運用している（記事にmbFASTを出さない、
 * 画面もホーム画面追加時の名前も mbPIT）。にもかかわらずアイコンだけが共通で、
 * 加盟店のホーム画面に mbFAST のアイコンが並ぶ状態だった。
 *
 * 既定では **正式なmbPITロゴ**（public/brand/mbpit-logo.jpg）から生成する。
 * ロゴが手元に無いときだけ --wordmark で暫定のワードマークを作れる。
 * 地色はmbPITの黒（#0d0d0d。記事トップバーやアプリUIと同じ）。
 *
 * 使い方:
 *   npx tsx scripts/make-pwa-icons.mts                       … 既定のロゴ(public/brand/mbpit-logo.jpg)から生成
 *   npx tsx scripts/make-pwa-icons.mts --from <画像>          … 別のロゴから生成
 *   npx tsx scripts/make-pwa-icons.mts --wordmark            … ロゴが無いときの暫定ワードマーク
 *
 * ロゴが横長のときの扱い（mbPITロゴは約4.2:1）:
 *  - まず**周囲の余地を自動で切る**（trim）。切らずに縮めると文字が小さくなりすぎる
 *  - `any` 用は幅88%まで使う（読める大きさを優先）
 *  - `maskable` 用は幅76%に抑える。Androidは中央の円（直径80%）だけを安全域として
 *    外側を切るため、横長ロゴは端が欠ける。円に収まる幅は
 *    w = D / sqrt(1 + 1/比^2) ≒ 0.97D なので、D=80% から余裕を見て76%とする
 */
import sharp from "sharp";
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const OUT = join(process.cwd(), "public", "icons");
/*
 * 地色は**純黒**にする。ロゴ画像の背景が #000000 のため、#0d0d0d のような
 * 「ほぼ黒」だと合成後にロゴの矩形だけが色違いになって四角い枠が見える（実際にそうなった）。
 */
const BG = "#000000";
const GOLD = "#d4af37";

const fromIndex = process.argv.indexOf("--from");
const useWordmark = process.argv.includes("--wordmark");
const DEFAULT_LOGO = join(process.cwd(), "public", "brand", "mbpit-logo.jpg");
const logoPath = useWordmark ? null : fromIndex > 0 ? process.argv[fromIndex + 1] : DEFAULT_LOGO;

/** ワードマークのSVG。maskable用に中央80%へ収める（端が切られても文字が残る） */
function wordmarkSvg(size: number): string {
  const fs = Math.round(size * 0.2);
  const ring = Math.round(size * 0.012);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
  <rect width="${size}" height="${size}" fill="${BG}"/>
  <rect x="${size * 0.1}" y="${size * 0.1}" width="${size * 0.8}" height="${size * 0.8}"
        rx="${size * 0.08}" fill="none" stroke="${GOLD}" stroke-width="${ring}" opacity="0.8"/>
  <text x="50%" y="50%" dy="0.36em" text-anchor="middle"
        font-family="DejaVu Sans, sans-serif" font-size="${fs}" font-weight="700" fill="${GOLD}"
        letter-spacing="${size * 0.005}">mbPIT</text>
</svg>`;
}

async function fromWordmark(size: number): Promise<Buffer> {
  return sharp(Buffer.from(wordmarkSvg(size))).png().toBuffer();
}

/**
 * 正式ロゴから作る。黒地の中央に、指定した幅の割合で配置する。
 * widthRatio: アイコン幅に対するロゴの幅（any=0.88 / maskable=0.76）
 */
async function fromLogo(src: string, size: number, widthRatio: number): Promise<Buffer> {
  // 周囲の余地を切ってロゴ本体だけにする（切らないと文字が小さくなりすぎる）
  const trimmed = await sharp(src).trim({ threshold: 15 }).toBuffer();
  const w = Math.round(size * widthRatio);
  const logo = await sharp(trimmed)
    .resize(w, undefined, { fit: "inside", withoutEnlargement: false })
    .png()
    .toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: BG } })
    .composite([{ input: logo, gravity: "center" }])
    .png()
    .toBuffer();
}

const make = (size: number, widthRatio: number) =>
  logoPath ? fromLogo(logoPath, size, widthRatio) : fromWordmark(size);

if (logoPath && !existsSync(logoPath)) {
  console.error(`ロゴファイルが見つかりません: ${logoPath}`);
  process.exit(2);
}

for (const [name, size, ratio] of [
  // any: 通常表示（そのまま出るので大きめに使う）
  ["pit-icon-192.png", 192, 0.88],
  ["pit-icon-512.png", 512, 0.88],
  // maskable: Androidが円などに切り抜くため安全域に収める
  ["pit-icon-512-maskable.png", 512, 0.76],
  // iOSのホーム画面（角丸は端末側で付く）
  ["pit-apple-touch-icon.png", 180, 0.88],
] as const) {
  const buf = await make(size, ratio);
  writeFileSync(join(OUT, name), buf);
  console.log(`生成: public/icons/${name}  ${size}x${size}  幅${Math.round(ratio * 100)}%  ${buf.length} bytes`);
}
console.log(logoPath ? `ロゴから生成しました: ${logoPath}` : "※ 暫定のワードマークから生成しました。");
