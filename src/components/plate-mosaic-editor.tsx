"use client";

// ナンバープレートモザイクの手動修正エディタ。
//  - 指でなぞった矩形にモザイク追加
//  - 既存のモザイク領域をタップで解除
// すべてブラウザ内のcanvas処理（画像は端末外に出ない）。

import { useCallback, useEffect, useRef, useState } from "react";
import { drawWithMosaic, type PlateBox } from "@/lib/plate-detect";

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
    drawWithMosaic(ctx, img, c.width, c.height, boxes);
    // モザイク領域の枠線（見つけやすく）
    ctx.save();
    ctx.strokeStyle = "#F2B01E";
    ctx.setLineDash([8, 6]);
    ctx.lineWidth = Math.max(2, c.width / 400);
    for (const b of boxes) ctx.strokeRect(b.x, b.y, b.w, b.h);
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

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/95">
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <p className="text-sm font-bold">🖌 ナンバーモザイク編集</p>
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
            setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
          }}
          onPointerMove={(e) => {
            if (!drag) return;
            const p = toImageCoords(e);
            setDrag({ ...drag, x1: p.x, y1: p.y });
          }}
          onPointerUp={() => {
            if (!drag) return;
            const w = Math.abs(drag.x1 - drag.x0);
            const h = Math.abs(drag.y1 - drag.y0);
            if (w > minDrag() && h > minDrag() / 2) {
              // なぞった矩形にモザイク追加
              setBoxes((bs) => [
                ...bs,
                { x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1), w, h },
              ]);
            } else {
              // タップ: その位置のモザイクを解除
              const px = drag.x1;
              const py = drag.y1;
              setBoxes((bs) => {
                const hit = [...bs].reverse().find(
                  (b) => px >= b.x && px <= b.x + b.w && py >= b.y && py <= b.y + b.h,
                );
                return hit ? bs.filter((b) => b !== hit) : bs;
              });
            }
            setDrag(null);
          }}
        />
      </div>
      <div className="space-y-2 px-4 py-3">
        <p className="text-center text-[11px] leading-relaxed text-white/80">
          隠したい場所を<b>指でなぞる</b>とモザイク追加、モザイクを<b>タップ</b>で解除できます。
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
