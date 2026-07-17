import sharp, { type OverlayOptions } from "sharp";
import Anthropic from "@anthropic-ai/sdk";

/*
 * mbPIT 画像処理。
 *  1. 長辺 1600px に縮小して JPEG 化（EXIF 回転を反映）
 *  2. ナンバープレート自動ぼかし: Claude の画像認識でプレートの矩形(0-1正規化)を検出し、
 *     該当領域にガウシアンぼかしを合成する。専用検出モデル(YOLO等)を持ち込まず、
 *     記事生成で既に使う Claude API に寄せる（サーバー依存を増やさない）。
 *  検出できなかった/検出呼び出しに失敗した画像もそのまま通す（過検出より未検出を許容）。
 *  ただし必ずログ(plateBlurLog)に残して本部が後追いできるようにする。
 */

export type PlateRegion = { x: number; y: number; w: number; h: number }; // 0-1 正規化

export type PlateBlurLogEntry = {
  index: number;
  detected: boolean;
  regions: number;
  error?: string; // 検出呼び出し失敗時の理由
};

export type ProcessedImage = {
  buffer: Buffer; // ぼかし・リサイズ済み JPEG
  width: number;
  height: number;
};

const MAX_EDGE = 1600;
const JPEG_QUALITY = 82;
// LLM の矩形は輪郭ぴったりに出ないことがあるため、少し広げてぼかす（読める文字を残さない）
const REGION_MARGIN = 0.25;

const VISION_MODEL = process.env.PIT_VISION_MODEL ?? "claude-sonnet-5";

const PLATE_TOOL: Anthropic.Tool = {
  name: "report_plates",
  description:
    "Report bounding boxes of every visible vehicle license plate (number plate) in the image.",
  input_schema: {
    type: "object",
    properties: {
      plates: {
        type: "array",
        description:
          "One entry per visible license plate. Coordinates are normalized to 0..1 relative to the full image (x,y = top-left corner).",
        items: {
          type: "object",
          properties: {
            x: { type: "number" },
            y: { type: "number" },
            w: { type: "number" },
            h: { type: "number" },
          },
          required: ["x", "y", "w", "h"],
        },
      },
    },
    required: ["plates"],
  },
};

async function detectPlates(jpeg: Buffer): Promise<PlateRegion[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY 未設定のためプレート検出をスキップ");
  const client = new Anthropic({ apiKey });
  const msg = await client.messages.create({
    model: VISION_MODEL,
    max_tokens: 500,
    tools: [PLATE_TOOL],
    tool_choice: { type: "tool", name: "report_plates" },
    messages: [
      {
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: "image/jpeg", data: jpeg.toString("base64") },
          },
          {
            type: "text",
            text: "Locate every visible vehicle license plate (Japanese number plates included) in this photo and call report_plates with normalized bounding boxes. If none are visible, report an empty array.",
          },
        ],
      },
    ],
  });
  const block = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  const plates = (block?.input as { plates?: unknown })?.plates;
  if (!Array.isArray(plates)) return [];
  return plates
    .filter(
      (p): p is PlateRegion =>
        !!p &&
        typeof (p as PlateRegion).x === "number" &&
        typeof (p as PlateRegion).y === "number" &&
        typeof (p as PlateRegion).w === "number" &&
        typeof (p as PlateRegion).h === "number",
    )
    .map((p) => ({
      x: Math.max(0, Math.min(1, p.x)),
      y: Math.max(0, Math.min(1, p.y)),
      w: Math.max(0, Math.min(1, p.w)),
      h: Math.max(0, Math.min(1, p.h)),
    }))
    .filter((p) => p.w > 0.001 && p.h > 0.001);
}

async function blurRegions(
  jpeg: Buffer,
  width: number,
  height: number,
  regions: PlateRegion[],
): Promise<Buffer> {
  let img = sharp(jpeg);
  const overlays: OverlayOptions[] = [];
  for (const r of regions) {
    // マージン付きでピクセル座標へ変換し、画像内にクランプ
    const mx = r.w * REGION_MARGIN;
    const my = r.h * REGION_MARGIN;
    const left = Math.max(0, Math.round((r.x - mx) * width));
    const top = Math.max(0, Math.round((r.y - my) * height));
    const w = Math.min(width - left, Math.round((r.w + mx * 2) * width));
    const h = Math.min(height - top, Math.round((r.h + my * 2) * height));
    if (w < 4 || h < 4) continue;
    // ぼかし強度は領域サイズに比例させる（大きく写ったプレートでも判読不能に）
    const sigma = Math.max(10, Math.round(Math.max(w, h) / 8));
    const blurred = await sharp(jpeg).extract({ left, top, width: w, height: h }).blur(sigma).toBuffer();
    overlays.push({ input: blurred, left, top });
  }
  if (overlays.length === 0) return jpeg;
  img = img.composite(overlays);
  return img.jpeg({ quality: JPEG_QUALITY }).toBuffer();
}

/** 1枚を処理: リサイズ→検出→ぼかし。検出失敗は素通し＋ログ。 */
export async function processPhoto(
  original: Buffer,
  index: number,
): Promise<{ image: ProcessedImage; log: PlateBlurLogEntry }> {
  // HEIC 等 sharp が読めない形式はここで例外 → 呼び出し側でユーザー向けエラーに変換
  const resized = await sharp(original)
    .rotate() // EXIF Orientation を反映（回転情報はJPEG化で失われるため先に適用）
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: JPEG_QUALITY })
    .toBuffer();
  const meta = await sharp(resized).metadata();
  const width = meta.width ?? MAX_EDGE;
  const height = meta.height ?? MAX_EDGE;

  let regions: PlateRegion[] = [];
  let error: string | undefined;
  try {
    regions = await detectPlates(resized);
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
  }

  let out: Buffer = resized;
  if (regions.length > 0) {
    try {
      out = await blurRegions(resized, width, height, regions);
    } catch (e) {
      // ぼかし合成失敗も素通し（ログには残す）
      error = `blur failed: ${e instanceof Error ? e.message : String(e)}`;
    }
  }

  return {
    image: { buffer: out, width, height },
    log: { index, detected: regions.length > 0, regions: regions.length, ...(error ? { error } : {}) },
  };
}
