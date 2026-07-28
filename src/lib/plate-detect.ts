"use client";

// ナンバープレート自動検出（ブラウザ内・onnxruntime-web/WASM）。
// モデルは /models/plate-detect.onnx（YOLOv5/v8系・1クラス・640x640）を想定し、
// 未設置・非対応端末では null を返して手動モザイクのみにフォールバックする。
// 生画像はブラウザ外に出さない（検出もモザイクもすべて端末内で完結）。

export type PlateBox = { x: number; y: number; w: number; h: number };

type Loaded = {
  ort: typeof import("onnxruntime-web");
  session: import("onnxruntime-web").InferenceSession;
};

let loader: Promise<Loaded | null> | null = null;

async function load(): Promise<Loaded | null> {
  try {
    const head = await fetch("/models/plate-detect.onnx", { method: "HEAD" });
    if (!head.ok) return null;
    const ort = await import("onnxruntime-web");
    ort.env.wasm.wasmPaths = "/ort/";
    ort.env.wasm.numThreads = 1; // COOP/COEPヘッダ不要のシングルスレッドで確実に動かす
    const session = await ort.InferenceSession.create("/models/plate-detect.onnx", {
      executionProviders: ["wasm"],
    });
    return { ort, session };
  } catch {
    return null; // 旧端末・モデル未設置 → 手動モザイクのみ
  }
}

// 投稿UI表示時に非同期プリロード（投稿操作を待たせない）
export function preloadPlateModel(): Promise<Loaded | null> {
  if (!loader) loader = load();
  return loader;
}

const INPUT = 640;
const CONF_TH = 0.35;
const IOU_TH = 0.45;

function iou(a: PlateBox, b: PlateBox): number {
  const x1 = Math.max(a.x, b.x);
  const y1 = Math.max(a.y, b.y);
  const x2 = Math.min(a.x + a.w, b.x + b.w);
  const y2 = Math.min(a.y + a.h, b.y + b.h);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  return inter / (a.w * a.h + b.w * b.h - inter || 1);
}

export async function detectPlates(
  img: CanvasImageSource,
  natW: number,
  natH: number,
): Promise<PlateBox[] | null> {
  const loaded = await preloadPlateModel();
  if (!loaded) return null;
  const { ort, session } = loaded;

  // letterbox → 640x640 RGB
  const scale = Math.min(INPUT / natW, INPUT / natH);
  const w = Math.round(natW * scale);
  const h = Math.round(natH * scale);
  const dx = Math.floor((INPUT - w) / 2);
  const dy = Math.floor((INPUT - h) / 2);
  const c = document.createElement("canvas");
  c.width = INPUT;
  c.height = INPUT;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.fillStyle = "#727272";
  ctx.fillRect(0, 0, INPUT, INPUT);
  ctx.drawImage(img, 0, 0, natW, natH, dx, dy, w, h);
  const px = ctx.getImageData(0, 0, INPUT, INPUT).data;
  const area = INPUT * INPUT;
  const input = new Float32Array(3 * area);
  for (let i = 0; i < area; i++) {
    input[i] = px[i * 4] / 255;
    input[area + i] = px[i * 4 + 1] / 255;
    input[2 * area + i] = px[i * 4 + 2] / 255;
  }

  const feeds: Record<string, import("onnxruntime-web").Tensor> = {
    [session.inputNames[0]]: new ort.Tensor("float32", input, [1, 3, INPUT, INPUT]),
  };
  const outputs = await session.run(feeds);
  const out = outputs[session.outputNames[0]];
  const dims = out.dims;
  const arr = out.data as Float32Array;

  const toOrig = (cx: number, cy: number, bw: number, bh: number): PlateBox => ({
    x: (cx - bw / 2 - dx) / scale,
    y: (cy - bh / 2 - dy) / scale,
    w: bw / scale,
    h: bh / scale,
  });

  const cand: { box: PlateBox; score: number }[] = [];
  if (dims.length === 3 && dims[1] < dims[2]) {
    // YOLOv8: [1, 4+nc, N]
    const n = dims[2];
    const nc = dims[1] - 4;
    for (let i = 0; i < n; i++) {
      let best = 0;
      for (let k = 0; k < nc; k++) best = Math.max(best, arr[(4 + k) * n + i]);
      if (best < CONF_TH) continue;
      cand.push({ score: best, box: toOrig(arr[i], arr[n + i], arr[2 * n + i], arr[3 * n + i]) });
    }
  } else if (dims.length === 3) {
    // YOLOv5: [1, N, 5+nc]
    const n = dims[1];
    const stride = dims[2];
    for (let i = 0; i < n; i++) {
      const o = i * stride;
      let cls = 1;
      if (stride > 5) {
        cls = 0;
        for (let k = 5; k < stride; k++) cls = Math.max(cls, arr[o + k]);
      }
      const score = arr[o + 4] * cls;
      if (score < CONF_TH) continue;
      cand.push({ score, box: toOrig(arr[o], arr[o + 1], arr[o + 2], arr[o + 3]) });
    }
  } else {
    return null; // 未知の出力形式 → 手動フォールバック
  }

  // NMS → 画像内にクランプ＋少し余白を持たせる
  cand.sort((a, b) => b.score - a.score);
  const kept: PlateBox[] = [];
  for (const c2 of cand) {
    if (kept.some((k) => iou(k, c2.box) > IOU_TH)) continue;
    kept.push(c2.box);
    if (kept.length >= 8) break;
  }
  return kept.map((b) => {
    const padX = b.w * 0.08;
    const padY = b.h * 0.15;
    const x = Math.max(0, b.x - padX);
    const y = Math.max(0, b.y - padY);
    return {
      x,
      y,
      w: Math.min(natW - x, b.w + padX * 2),
      h: Math.min(natH - y, b.h + padY * 2),
    };
  });
}

// 指定領域をピクセルモザイク化して描画（判読不能になる粒度）
export function drawWithMosaic(
  ctx: CanvasRenderingContext2D,
  img: CanvasImageSource,
  natW: number,
  natH: number,
  boxes: PlateBox[],
): void {
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(img, 0, 0, natW, natH);
  for (const b of boxes) {
    const w = Math.max(2, Math.round(b.w));
    const h = Math.max(2, Math.round(b.h));
    // 横方向を最大10セルに落とす＝1文字未満の解像度で判読不能
    const sw = Math.max(1, Math.min(10, Math.round(w / 24)));
    const sh = Math.max(1, Math.round((h / w) * sw) || 1);
    const off = document.createElement("canvas");
    off.width = sw;
    off.height = sh;
    const octx = off.getContext("2d")!;
    octx.imageSmoothingEnabled = true;
    octx.drawImage(img, b.x, b.y, w, h, 0, 0, sw, sh);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(off, 0, 0, sw, sh, b.x, b.y, w, h);
    ctx.imageSmoothingEnabled = true;
  }
}
