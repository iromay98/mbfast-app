"use client";

// 車検証QRスキャナ（カメラ + jsQR）。
// 車検証には複数のQRが並んでいるため、映った全QRを順に読んで onText に渡す。
// 呼び出し側が「車台番号が取れたか」を判定して閉じる。カメラ不可端末は手入力にフォールバック。

import { useCallback, useEffect, useRef, useState } from "react";
import jsQR from "jsqr";

export function ShakenQrScanner({
  onText,
  onClose,
}: {
  onText: (text: string) => boolean; // true を返したらスキャン終了
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);
  const stopRef = useRef(false);
  const seenRef = useRef<Set<string>>(new Set());
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

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
        <p className="text-sm font-bold">📄 車検証のQRコードを映してください</p>
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
        {error ?? "車検証の下部に並んでいるQRコードを順番に枠へ。車台番号を読み取ると自動で閉じます。"}
      </p>
    </div>
  );
}

// クライアント側の簡易判定（サーバー側 parseShakenQr と同じ規則の軽量版）
export function chassisFromQrText(text: string): string | null {
  const fields = text
    .split(/[\/\n\r]+/)
    .map((f) =>
      f
        .trim()
        .replace(/[Ａ-Ｚａ-ｚ０-９－]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
        .toUpperCase()
        .replace(/[^A-Z0-9-]/g, ""),
    )
    .filter(Boolean);
  for (const f of fields) {
    if (/^\d/.test(f) && /^[A-Z0-9]{2,4}-[A-Z][A-Z0-9]{1,9}$/.test(f)) continue; // 型式はスキップ
    if (/^[A-Z][A-Z0-9]{1,9}-\d{4,8}$/.test(f) || /^[A-HJ-NPR-Z0-9]{17}$/.test(f)) return f;
  }
  return null;
}
