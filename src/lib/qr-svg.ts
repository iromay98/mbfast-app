/*
 * QRコードをSVG文字列で作る（サーバー・クライアント両方で動く／外部リクエストなし）。
 * 施工証明書の紙・PDFに載せる検証用QRのため、画像生成の依存を増やさずに済ませる。
 * エンコーダは既に入っている @zxing/library のものを使う（読み取りと同じ実装系）。
 */
import {
  QRCodeEncoder,
  EncodeHintType,
  QRCodeDecoderErrorCorrectionLevel as ErrorCorrectionLevel,
} from "@zxing/library";

/**
 * @param text QRに入れる文字列（URL）
 * @param size SVGの一辺(px)
 * @param quiet 余白（モジュール数。規格の推奨は4）
 */
export function qrSvg(text: string, size = 120, quiet = 2): string {
  const hints = new Map<EncodeHintType, unknown>();
  // 日本語を含めない前提だが、明示しておく（URLはASCII）
  hints.set(EncodeHintType.CHARACTER_SET, "UTF-8");
  const code = QRCodeEncoder.encode(text, ErrorCorrectionLevel.M, hints as never);
  const matrix = code.getMatrix();
  const w = matrix.getWidth();
  const h = matrix.getHeight();
  const total = w + quiet * 2;

  // 1モジュール=1単位の座標系で描き、viewBoxで拡大する（どの大きさでも滲まない）
  const rects: string[] = [];
  for (let y = 0; y < h; y++) {
    let runStart = -1;
    for (let x = 0; x <= w; x++) {
      const on = x < w && matrix.get(x, y) === 1;
      if (on && runStart < 0) runStart = x;
      if (!on && runStart >= 0) {
        rects.push(`<rect x="${runStart + quiet}" y="${y + quiet}" width="${x - runStart}" height="1"/>`);
        runStart = -1;
      }
    }
  }
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${total} ${total}" shape-rendering="crispEdges" role="img" aria-label="検証用QRコード">`,
    `<rect width="${total}" height="${total}" fill="#ffffff"/>`,
    `<g fill="#000000">${rects.join("")}</g>`,
    `</svg>`,
  ].join("");
}
