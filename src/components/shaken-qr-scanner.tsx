"use client";

// 車検証QRスキャナ（カメラ + jsQR）。
// 車検証には複数のQRが並んでいるため、映った全QRを順に読んで onText に渡す。
// 呼び出し側が「車台番号が取れたか」を判定して閉じる。カメラ不可端末は手入力にフォールバック。

import { useCallback, useEffect, useRef, useState } from "react";
import { scanPass, scanQrFromFile } from "@/lib/qr-scan";

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
  const photoRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  // 読めた生データ。解析できなかったときに画面で確認できるようにする
  // （どんなQRだったのか分からないと直せない）。
  const [raw, setRaw] = useState<string[]>([]);
  const [showRaw, setShowRaw] = useState(false);
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

  /*
   * 写真から読み取る。ライブ映像だとピントが合わず読めないことが多いため、
   * 端末のカメラアプリで撮った1枚（高解像度・ピント合わせ済み）から読む道を必ず用意する。
   */
  const readPhoto = async (file: File) => {
    setReading(true);
    setError(null);
    try {
      const texts = await scanQrFromFile(file);
      if (texts.length === 0) {
        setError("この写真からはQRを読み取れませんでした。QRに寄って、明るいところで撮り直してください。");
        return;
      }
      let done = false;
      for (const t of texts) {
        if (!seenRef.current.has(t)) {
          seenRef.current.add(t);
          setRaw((r) => [...r, t]);
          if (onTextRef.current(t)) done = true;
        }
      }
      if (done) {
        stopCamera();
        return;
      }
      setError(
        `QRは${texts.length}個読めましたが、車台番号・型式が見つかりませんでした。下の「読み取れた内容」をご確認ください。`,
      );
      setShowRaw(true);
    } catch {
      setError("写真の読み取りに失敗しました。もう一度お試しください。");
    } finally {
      setReading(false);
      if (photoRef.current) photoRef.current.value = "";
    }
  };

  useEffect(() => {
    let raf = 0;
    (async () => {
      try {
        // 車検証のQRは小さいので、取れるだけ高い解像度を要求する
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
        });
        const v = videoRef.current;
        if (!v) return;
        v.srcObject = stream;
        await v.play();
        const canvas = canvasRef.current!;
        const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
        let pass = 0;
        const tick = () => {
          if (stopRef.current) return;
          if (v.readyState >= 2 && v.videoWidth > 0) {
            canvas.width = v.videoWidth;
            canvas.height = v.videoHeight;
            ctx.drawImage(v, 0, 0);
            // 全体・中央1/2・中央1/4 を順番に試す（小さいQRは切り出した方が読める）
            const text = scanPass(ctx, canvas.width, canvas.height, pass++);
            if (text && !seenRef.current.has(text)) {
              seenRef.current.add(text);
              setRaw((r) => [...r, text]);
              if (onTextRef.current(text)) {
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
        { }
        <video ref={videoRef} playsInline muted className="h-full w-full object-cover" />
        <canvas ref={canvasRef} className="hidden" />
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="h-52 w-52 rounded-2xl border-2 border-gold-400/90" />
        </div>
      </div>
      <div className="px-4 py-3">
        <p className="text-center text-[11px] leading-relaxed text-white/80">
          {error ??
            hint ??
            "QRが複数あってもそのまま車検証全体を映してください。必要なQRを自動で探します。"}
        </p>
        {/* カメラの映像では小さいQRにピントが合わないことがある。写真からも読める道を用意する */}
        <input
          ref={photoRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void readPhoto(f);
          }}
        />
        <div className="mt-2 flex flex-wrap items-center justify-center gap-2">
          <button
            type="button"
            disabled={reading}
            onClick={() => photoRef.current?.click()}
            className="rounded-lg bg-white/15 px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
          >
            {reading ? "読み取り中…" : "📷 QRを撮って読み取る（うまく読めない時）"}
          </button>
          {raw.length > 0 && (
            <button
              type="button"
              onClick={() => setShowRaw((v) => !v)}
              className="rounded-lg border border-white/40 px-3 py-2 text-xs font-semibold text-white/90"
            >
              読み取れた内容 {raw.length}件
            </button>
          )}
        </div>
        {showRaw && raw.length > 0 && (
          <div className="mt-2 max-h-32 overflow-auto rounded-lg bg-black/60 p-2">
            {raw.map((t, i) => (
              <p key={`${i}-${t.slice(0, 8)}`} className="break-all font-mono text-[10px] text-white/80">
                {i + 1}: {t}
              </p>
            ))}
            <p className="mt-1 text-[10px] text-white/60">
              車台番号が含まれます。読めているのに登録できないときは、この内容を本部にお知らせください。
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

// 判定は src/server/pit/shaken-qr.ts に集約した（サーバーとクライアントで規則がズレないように）。
// 互換のため同名で再エクスポートする。
export { chassisFromQrText } from "@/server/pit/shaken-qr";
