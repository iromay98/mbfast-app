"use client";

// 車検証QRスキャナ（カメラ + jsQR）。
// 車検証には複数のQRが並んでいるため、映った全QRを順に読んで onText に渡す。
// 呼び出し側が「車台番号が取れたか」を判定して閉じる。カメラ不可端末は手入力にフォールバック。

import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

export function ShakenQrScanner({
  onText,
  onClose,
  status,
  hint,
}: {
  onText: (text: string) => boolean; // true を返したらスキャン終了
  onClose: () => void;
  /** 読み取り状況（例「車台番号 ✓ / 型式 …」）。呼び出し側が組み立てて渡す */
  status?: string;
  /** 下部の案内文の差し替え */
  hint?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef(false);
  const seenRef = useRef<Set<string>>(new Set());
  // 最新の onText を effect から参照するための箱。
  // render 中に ref を書くと React の警告になるので effect で更新する。
  const onTextRef = useRef(onText);
  useEffect(() => {
    onTextRef.current = onText;
  }, [onText]);

  const stopCamera = useCallback(() => {
    stopRef.current = true;
    const v = videoRef.current;
    const stream = v?.srcObject as MediaStream | null;
    stream?.getTracks().forEach((t) => t.stop());
    if (v) v.srcObject = null;
  }, []);

  useEffect(() => {
    let raf = 0;
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1280 }, height: { ideal: 720 } },
        });
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = stream;
        await v.play();
        const canvas = canvasRef.current!;
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        const tick = () => {
          if (stopRef.current) return;
          if (v.readyState >= 2 && v.videoWidth > 0) {
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            ctx.drawImage(v, 0, 0);
            const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const code = jsQR(img.data, img.width, img.height, { inversionAttempts: "dontInvert" });
            if (code?.data && !seenRef.current.has(code.data)) {
              seenRef.current.add(code.data);
              if (onTextRef.current(code.data)) {
                stopCamera();
                return;
              }
            }
          }
          raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      } catch {
        setError("カメラを起動できませんでした。カメラ許可を確認するか、下の手入力をお使いください。");
      }
    })();
    return () => {
      cancelAnimationFrame(raf);
      stopCamera();
    };
  }, [stopCamera]);

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black/90">
      <div className="flex items-center justify-between px-4 py-3 text-white">
        <div className="min-w-0">
          <p className="text-sm font-bold">📄 車検証のQRコードを映してください</p>
          {/* QRは複数あるので「どれを読むか選ばせない」。取れた項目だけ示す */}
          {status && <p className="mt-0.5 truncate text-[11px] text-gold-300">{status}</p>}
        </div>
        <button
          type="button"
          onClick={() => {
            stopCamera();
            onClose();
          }}
          className="rounded-full bg-white/20 px-3 py-1 text-sm"
        >
          閉じる
        </button>
      </div>
      <div className="relative flex-1">
        {/* eslint-disable-next-line jsx-a11y/media-has-caption */}
        <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
        <canvas ref={canvasRef} className="hidden" />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-52 w-52 rounded-2xl border-2 border-gold-400/90" />
        </div>
      </div>
      <p className="px-4 py-3 text-center text-[11px] leading-relaxed text-white/80">
        {error ??
          hint ??
          "QRが複数あってもそのまま車検証全体を映してください。必要なQRを自動で探します。"}
      </p>
    </div>
  );
}

// 判定は src/server/pit/shaken-qr.ts に集約した（サーバーとクライアントで規則がズレないように）。
// 互換のため同名で再エクスポートする。
export { chassisFromQrText } from "@/server/pit/shaken-qr";
