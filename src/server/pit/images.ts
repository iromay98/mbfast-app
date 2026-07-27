// mbPIT 画像処理: リサイズ(長辺1600px)＋WebP化(quality 80)。
// EXIF/GPS等のメタデータは sharp が出力時に落とす（店舗・顧客の位置情報漏洩防止）。
// ナンバープレート自動ぼかしはPhase 4で追加予定（processPhoto がその差し込み口）。

import sharp from "sharp";

export type ProcessedImage = {
  buffer: Buffer;
  plateDetected: boolean | null; // null = 検出処理未実装（Phase 4まで）
};

const MAX_EDGE = 1600;
const WEBP_QUALITY = 80;

export const PIT_IMAGE_MIME = "image/webp";
export const PIT_IMAGE_EXT = "webp";

export async function processPhoto(input: Buffer): Promise<ProcessedImage> {
  // HEIC等も sharp が読める形式なら通す。EXIFの回転を適用し、位置情報等のメタデータは落とす。
  const buffer = await sharp(input, { failOn: "none" })
    .rotate()
    .resize(MAX_EDGE, MAX_EDGE, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();
  return { buffer, plateDetected: null };
}

// SEO用ファイル名: {車種ローマ字}-{施工slug}-{連番}.webp（ローマ字はAI生成のslugから拝借）
export function seoFilename(baseSlug: string, index: number): string {
  const safe = baseSlug.replace(/[^a-z0-9-]/gi, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  return `${safe || "mbpit"}-${index + 1}.${PIT_IMAGE_EXT}`;
}
