/*
 * QRの読み取り試行（ブラウザ専用）。
 *
 * 車検証のQRは券面に数個並んだ小さなQRなので、フレーム全体を1回だけ読む方式では
 * 解像度が足りず失敗しやすい。中央を切り出して拡大した領域も試す。
 * 「読めなかった」で終わらせないため、読めた生データを呼び出し側に返して画面に出せるようにする。
 */
import jsQR from "jsqr";

export type QrHit = { text: string };

/** キャンバスの指定領域を読む（領域が小さいほど1QRあたりの解像度が上がる） */
function scanRegion(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  invert: boolean,
): string | null {
  if (w < 40 || h < 40) return null;
  const img = ctx.getImageData(x, y, w, h);
  const code = jsQR(img.data, img.width, img.height, {
    inversionAttempts: invert ? "attemptBoth" : "dontInvert",
  });
  return code?.data ?? null;
}

/*
 * 全体 → 中央1/2 → 中央1/3 の順に試す。
 * カメラのライブ映像では毎フレーム全部やると重いので pass で1つずつ回す。
 */
export function scanPass(ctx: CanvasRenderingContext2D, w: number, h: number, pass: number): string | null {
  const p = pass % 3;
  if (p === 0) return scanRegion(ctx, 0, 0, w, h, false);
  if (p === 1) {
    return scanRegion(ctx, Math.floor(w / 4), Math.floor(h / 4), Math.floor(w / 2), Math.floor(h / 2), false);
  }
  return scanRegion(ctx, Math.floor(w / 3), Math.floor(h / 3), Math.floor(w / 3), Math.floor(h / 3), true);
}

/*
 * 静止画（撮った写真）から読む。写真は端末のカメラアプリが撮るので
 * ライブ映像よりピントも解像度も良い＝小さいQRはこちらの方が確実。
 * 3x3のタイルに分けて1つずつ読み、見つかったものを全部返す。
 */
export async function scanQrFromFile(file: File): Promise<string[]> {
  const bitmap = await createImageBitmap(file);
  const max = 2400; // 大きすぎる写真は縮める（読み取り精度と速度の折り合い）
  const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  const found = new Set<string>();
  const whole = scanRegion(ctx, 0, 0, w, h, true);
  if (whole) found.add(whole);
  // タイル分割（重なりを持たせて境界のQRも拾う）
  const cols = 3;
  const rows = 3;
  const tw = Math.floor(w / cols);
  const th = Math.floor(h / rows);
  const overlapX = Math.floor(tw / 4);
  const overlapY = Math.floor(th / 4);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = Math.max(0, c * tw - overlapX);
      const y = Math.max(0, r * th - overlapY);
      const ww = Math.min(w - x, tw + overlapX * 2);
      const hh = Math.min(h - y, th + overlapY * 2);
      const hit = scanRegion(ctx, x, y, ww, hh, true);
      if (hit) found.add(hit);
    }
  }
  return [...found];
}
