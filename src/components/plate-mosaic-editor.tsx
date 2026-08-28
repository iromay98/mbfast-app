"use client";

// ナンバープレートぼかしの手動修正エディタ（CARTUNE等と同じ操作感を目標）。
//  - 何もない所をなぞる → ぼかし追加
//  - 四角の「角」をドラッグ → 大きさ調整（自動検出のズレを直す）
//  - 四角の中をドラッグ → 移動
//  - 四角をタップ → 解除
// すべてブラウザ内のcanvas処理（画像は端末外に出ない）。

import { useCallback, useEffect, useRef, useState } from "react";
import { drawWithBlur, type PlateBox } from "@/lib/plate-detect";

export function PlateMosaicEditor({
  src,
  initialBoxes,
  onSave,
  onClose,
}: {
  src: string; // objectURL
  initialBoxes: PlateBox[];
  onSave: (boxes: PlateBox[]) => void;
  onClose: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [boxes, setBoxes] = useState<PlateBox[]>(initialBoxes);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  /*
   * 角ドラッグ=resize / 中ドラッグ=move。moved は「タップか移動か」の判定用
   * （動かさず離した=タップ→解除。少しでも動いたら移動なので解除しない）
   */
  const [edit, setEdit] = useState<
    | { type: "resize"; idx: number; anchorX: number; anchorY: number }
    | { type: "move"; idx: number; grabDx: number; grabDy: number; moved: boolean }
    | null
  >(null);
  const [ready, setReady] = useState(false);

  // 画像ロード → canvasを実寸で用意
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      imgRef.current = img;
      const c = canvasRef.current;
      if (!c) return;
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      setReady(true);
    };
    img.src = src;
  }, [src]);

  // 再描画
  useEffect(() => {
    const c = canvasRef.current;
    const img = imgRef.current;
    if (!c || !img || !ready) return;
    const ctx = c.getContext("2d")!;
    drawWithBlur(ctx, img, c.width, c.height, boxes);
    // ぼかし領域の枠線（見つけやすく）
    ctx.save();
    ctx.strokeStyle = "#F2B01E";
    ctx.setLineDash([8, 6]);
    ctx.lineWidth = Math.max(2, c.width / 400);
    const hs = handleSize();
    for (const b of boxes) {
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      // 角ハンドル（ここを掴んで大きさを直せることが見て分かるように）
      ctx.setLineDash([]);
      ctx.fillStyle = "#F2B01E";
      for (const [cx, cy] of corners(b)) ctx.fillRect(cx - hs / 2, cy - hs / 2, hs, hs);
      ctx.setLineDash([8, 6]);
    }
    if (drag) {
      ctx.strokeStyle = "#E53935";
      ctx.strokeRect(
        Math.min(drag.x0, drag.x1),
        Math.min(drag.y0, drag.y1),
        Math.abs(drag.x1 - drag.x0),
        Math.abs(drag.y1 - drag.y0),
      );
    }
    ctx.restore();
  }, [boxes, drag, ready]);

  const toImageCoords = useCallback((e: { clientX: number; clientY: number }) => {
    const c = canvasRef.current!;
    const r = c.getBoundingClientRect();
    return {
      x: ((e.clientX - r.left) / r.width) * c.width,
      y: ((e.clientY - r.top) / r.height) * c.height,
    };
  }, []);

  const minDrag = () => (canvasRef.current ? canvasRef.current.width / 40 : 20);
  // ハンドルの一辺（画像px）。画面上でおよそ14px相当になるよう表示倍率から逆算する
  const handleSize = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return 16;
    const r = c.getBoundingClientRect();
    return Math.max(12, 14 * (c.width / Math.max(1, r.width)));
  }, []);
  const corners = (b: PlateBox): [number, number][] => [
    [b.x, b.y],
    [b.x + b.w, b.y],
    [b.x, b.y + b.h],
    [b.x + b.w, b.y + b.h],
  ];
  /** 指の位置がどの箱のどの角か。指はズレるのでハンドルの1.6倍まで許容する */
  const hitCorner = (px: number, py: number) => {
    const tol = handleSize() * 1.6;
    for (let i = boxes.length - 1; i >= 0; i--) {
      for (const [cx, cy] of corners(boxes[i])) {
        if (Math.abs(px - cx) <= tol && Math.abs(py - cy) <= tol) {
          const b = boxes[i];
          // 掴んだ角の対角を固定点にする
          return { idx: i, anchorX: px < b.x + b.w / 2 ? b.x + b.w : b.x, anchorY: py < b.y + b.h / 2 ? b.y + b.h : b.y };
        }
      }
    }
    return null;
  };
  const hitBox = (px: number, py: number) => {
    for (let i = boxes.length - 1; i >= 0; i--) {
      const b = boxes[i];
      if (px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h) return i;
    }
    return -1;
  };
  const clampBox = (b: PlateBox): PlateBox => {
    const c = canvasRef.current!;
    const x = Math.max(0, Math.min(b.x, c.width - 2));
    const y = Math.max(0, Math.min(b.y, c.height - 2));
    return { x, y, w: Math.max(2, Math.min(b.w, c.width - x)), h: Math.max(2, Math.min(b.h, c.height - y)) };
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95">
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <p className="text-sm font-bold">🖌 ナンバーぼかし編集</p>
        <button type="button" onClick={onClose} className="rounded-full bg-white/20 px-3 py-1 text-sm">
          キャンセル
        </button>
      </div>
      <div className="flex flex-1 items-center justify-center overflow-hidden px-2">
        <canvas
          ref={canvasRef}
          className="max-h-full max-w-full touch-none rounded-lg"
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
            const p = toImageCoords(e);
            // 優先順: 角（大きさ調整）→ 箱の中（移動/タップ解除）→ 何もない所（新規）
            const corner = hitCorner(p.x, p.y);
            if (corner) {
              setEdit({ type: "resize", ...corner });
              return;
            }
            const idx = hitBox(p.x, p.y);
            if (idx >= 0) {
              const b = boxes[idx];
              setEdit({ type: "move", idx, grabDx: p.x - b.x, grabDy: p.y - b.y, moved: false });
              return;
            }
            setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
          }}
          onPointerMove={(e) => {
            const p = toImageCoords(e);
            if (edit?.type === "resize") {
              setBoxes((bs) =>
                bs.map((b, i) =>
                  i === edit.idx
                    ? clampBox({
                        x: Math.min(p.x, edit.anchorX),
                        y: Math.min(p.y, edit.anchorY),
                        w: Math.abs(p.x - edit.anchorX),
                        h: Math.abs(p.y - edit.anchorY),
                      })
                    : b,
                ),
              );
              return;
            }
            if (edit?.type === "move") {
              if (!edit.moved) setEdit({ ...edit, moved: true });
              setBoxes((bs) =>
                bs.map((b, i) =>
                  i === edit.idx ? clampBox({ ...b, x: p.x - edit.grabDx, y: p.y - edit.grabDy }) : b,
                ),
              );
              return;
            }
            if (!drag) return;
            setDrag({ ...drag, x1: p.x, y1: p.y });
          }}
          onPointerUp={() => {
            if (edit) {
              // 移動モードで一度も動かさず離した=タップ → 解除。
              // 大きさが極端に小さくなった箱は誤操作なので消す
              if (edit.type === "move" && !edit.moved) {
                setBoxes((bs) => bs.filter((_, i) => i !== edit.idx));
              } else {
                setBoxes((bs) => bs.filter((b) => b.w > 4 && b.h > 4));
              }
              setEdit(null);
              return;
            }
            if (!drag) return;
            const w = Math.abs(drag.x1 - drag.x0);
            const h = Math.abs(drag.y1 - drag.y0);
            if (w > minDrag() && h > minDrag() / 2) {
              setBoxes((bs) => [
                ...bs,
                { x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1), w, h },
              ]);
            }
            setDrag(null);
          }}
        />
      </div>
      <div className="space-y-2 px-4 py-3">
        <p className="text-center text-[11px] leading-relaxed text-white/80">
          <b>なぞる</b>と追加 ・ <b>角をドラッグ</b>で大きさ調整 ・ <b>中をドラッグ</b>で移動 ・ <b>タップ</b>で解除
        
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setBoxes([])}
            className="flex-1 rounded-xl border border-white/30 py-3 text-sm font-bold text-white"
          >
            全解除
          </button>
          <button
            type="button"
            onClick={() => onSave(boxes)}
            className="flex-[2] rounded-xl bg-gold-500 py-3 text-sm font-extrabold text-white"
          >
            ✓ この内容で確定（{boxes.length}箇所）
          </button>
        </div>
      </div>
    </div>
  );
}
