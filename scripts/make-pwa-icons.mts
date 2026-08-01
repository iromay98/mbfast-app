/*
 * ホーム画面（PWA）アイコンを生成する。
 *
 * なぜ必要か: mbPITは**mbFASTとは別ブランド**として運用している（記事にmbFASTを出さない、
 * 画面もホーム画面追加時の名前も mbPIT）。にもかかわらずアイコンだけが共通で、
 * 加盟店のホーム画面に mbFAST のアイコンが並ぶ状態だった。
 *
 * ここで作るのは **暫定アイコン**（黒地×ゴールドの mbPIT ワードマーク）。
 * 既存のmbPIT表現（記事トップバー: 背景#0d0d0d・下線#c9a227、アプリUIも黒×金）に合わせている。
 * **正式なロゴ画像を受け取ったら `--from <ロゴファイル>` で差し替える**（下記）。
 *
 * 使い方:
 *   npx tsx scripts/make-pwa-icons.mts              … ワードマークから生成（暫定）
 *   npx tsx scripts/make-pwa-icons.mts --from logo.png … 正式ロゴから生成（余白付きで中央に配置）
 */
import sharp from "sharp";
import { writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const OUT = join(process.cwd(), "public", "icons");
const BG = "#0d0d0d"; // mbPITの地色（記事トップバーと同じ）
const GOLD = "#d4af37";

const fromIndex = process.argv.indexOf("--from");
const logoPath = fromIndex > 0 ? process.argv[fromIndex + 1] : null;

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

/** 正式ロゴから作る場合: 黒地の中央に、周囲20%の余白をとって配置する */
async function fromLogo(src: string, size: number): Promise<Buffer> {
  const inner = Math.round(size * 0.6);
  const logo = await sharp(src)
    .resize(inner, inner, { fit: "inside", withoutEnlargement: false, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();
  return sharp({
    create: { width: size, height: size, channels: 4, background: BG },
  })
    .composite([{ input: logo, gravity: "center" }])
    .png()
    .toBuffer();
}

const make = (size: number) => (logoPath ? fromLogo(logoPath, size) : fromWordmark(size));

if (logoPath && !existsSync(logoPath)) {
  console.error(`ロゴファイルが見つかりません: ${logoPath}`);
  process.exit(2);
}

for (const [name, size] of [
  ["pit-icon-192.png", 192],
  ["pit-icon-512.png", 512],
  ["pit-apple-touch-icon.png", 180],
] as const) {
  const buf = await make(size);
  writeFileSync(join(OUT, name), buf);
  console.log(`生成: public/icons/${name}  ${size}x${size}  ${buf.length} bytes`);
}
console.log(
  logoPath
    ? "正式ロゴから生成しました。"
    : "※ 暫定のワードマークです。正式なmbPITロゴを受け取ったら --from <ロゴ> で作り直してください。",
);
