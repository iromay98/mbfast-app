"use client";

/*
 * 電子車検証 二次元コード スキャナ（カメラ・ライブ）
 *
 * 券面の二次元コード2（QR2枚）/ 二次元コード3（QR3枚）は QR Structured Append で分割されている。
 * ZXing で各シンボルを連続デコードし、Structured Append のパリティでグループ化・位置順に
 * バイト結合 → Shift_JIS 復号 → "/"区切りで項目数判定（6=コード2 / 21=コード3）して解析する。
 *
 * カメラが使えない環境向けに「手動貼り付け」フォールバックも備える（同じパーサを通す）。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import type {
  BrowserQRCodeReader as ZXReader,
  DecodeHintType as ZXHintType,
  Result as ZXResult,
  ResultMetadataType as ZXMetaType,
} from "@zxing/library";
import {
  classifyCode,
  mergeShaken,
  parseCode2,
  parseCode3,
  type ShakenRaw,
  type ShakenVehicleInfo,
} from "@/lib/shaken/parse";

type Props = {
  /**
   * 読み取り結果。extra は二次元コードには入っていない項目（PDFから読めたときだけ入る）。
   * 既存の呼び出し側を壊さないよう第3引数は任意にしている。
   */
  onParsed: (
    info: ShakenVehicleInfo,
    raw: ShakenRaw,
    extra?: { makerName?: string; userName?: string; userAddress?: string },
  ) => void;
  className?: string;
};

type Phase = "idle" | "scanning" | "error" | "confirm";

// 取得済みの生コード
type Captured = { code2?: string; code3?: string };

function bytesFromResult(result: ZXResult, byteSegmentsKey: ZXMetaType): Uint8Array {
  const meta = result.getResultMetadata?.();
  const segs = meta?.get(byteSegmentsKey) as ArrayLike<number>[] | undefined;
  if (segs && segs.length) {
    let total = 0;
    for (const s of segs) total += s.length;
    const out = new Uint8Array(total);
    let o = 0;
    for (const s of segs) {
      const u = Uint8Array.from(s as ArrayLike<number>);
      out.set(u, o);
      o += u.length;
    }
    return out;
  }
  // フォールバック: テキストを Latin-1 バイトとして復元
  const txt: string = result.getText() ?? "";
  const out = new Uint8Array(txt.length);
  for (let i = 0; i < txt.length; i++) out[i] = txt.charCodeAt(i) & 0xff;
  return out;
}

function assembleGroup(frags: Map<number, Uint8Array>): string {
  const positions = [...frags.keys()].sort((a, b) => a - b);
  let total = 0;
  for (const p of positions) total += frags.get(p)!.length;
  const buf = new Uint8Array(total);
  let o = 0;
  for (const p of positions) {
    const b = frags.get(p)!;
    buf.set(b, o);
    o += b.length;
  }
  return new TextDecoder("shift_jis").decode(buf);
}

export function ShakenScanner({ onParsed, className }: Props) {
  /*
   * PDF読み取り（車検証閲覧アプリの出力）。
   * 2023年以降のA6電子車検証は券面の記載が省略されており、二次元コードにも
   * 有効期間・氏名・住所が入っていない。閲覧アプリのPDFはICチップの中身なので
   * 全部揃う。mbPIT側の車両登録と同じAPIを使う（読み取りの実装を二重に持たない）。
   */
  const pdfRef = useRef<HTMLInputElement>(null);
  const [pdfReading, setPdfReading] = useState(false);
  const [pdfNote, setPdfNote] = useState<string | null>(null);
  const [pdfError, setPdfError] = useState<string | null>(null);

  const readFile = async (file: File) => {
    setPdfReading(true);
    setPdfNote(null);
    setPdfError(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch("/api/pit/shaken-ocr", { method: "POST", body: fd });
      const body = (await res.json()) as {
        error?: string;
        fields?: Record<string, string>;
        warnings?: string[];
        source?: "text" | "ai" | "photo";
      };
      if (!res.ok || !body.fields) {
        setPdfError(body.error ?? "読み取れませんでした。手入力で進めてください");
        return;
      }
      const f = body.fields;
      // ShakenVehicleInfo（二次元コードと同じ形）へ寄せてから既存の流れに載せる
      const year = /^(\d{4})-\d{2}$/.exec(f.firstRegistered ?? "")?.[1];
      onParsed(
        {
          vin: f.vin || undefined,
          registrationNumber: f.registrationNumber || undefined,
          vehicleModelCode: f.modelCode || undefined,
          firstRegistration: f.firstRegistered || undefined,
          carYear: year ? Number(year) : undefined,
          inspectionExpiry: (f.inspectionExpiry ?? "").length === 10 ? f.inspectionExpiry : undefined,
        },
        {},
        { makerName: f.makerName || undefined, userName: f.userName || undefined, userAddress: f.userAddress || undefined },
      );
      setPdfNote(
        body.source === "text"
          ? "✅ PDFの文字をそのまま読み取りました（画像認識ではないので誤読はありません）。内容をご確認ください"
          : body.source === "ai"
            ? "このPDFは画像だったため画像認識で読み取りました。値をよく確認してください"
            : "写真から読み取りました。誤読があり得るので値をよく確認してください",
      );
    } catch {
      setPdfError("通信エラーが発生しました。手入力で進めてください");
    } finally {
      setPdfReading(false);
      if (pdfRef.current) pdfRef.current.value = "";
    }
  };

  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [captured, setCaptured] = useState<Captured>({});
  const [manual, setManual] = useState("");
  const [showManual, setShowManual] = useState(false);

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const readerRef = useRef<ZXReader | null>(null);
  // パリティ(=グループ) -> 位置 -> バイト列
  const fragsRef = useRef<Map<string, Map<number, Uint8Array>>>(new Map());
  const capturedRef = useRef<Captured>({});

  const stop = useCallback(() => {
    try {
      readerRef.current?.reset?.();
    } catch {
      /* noop */
    }
    readerRef.current = null;
  }, []);

  // アンマウント時にカメラ停止
  useEffect(() => () => stop(), [stop]);

  const ingestText = useCallback((text: string) => {
    const kind = classifyCode(text);
    if (kind === "unknown") return;
    capturedRef.current = { ...capturedRef.current, [kind]: text };
    setCaptured({ ...capturedRef.current });
  }, []);

  const finalize = useCallback(() => {
    stop();
    setPhase("confirm");
  }, [stop]);

  const startScan = useCallback(async () => {
    setError(null);
    setCaptured({});
    capturedRef.current = {};
    fragsRef.current = new Map();

    // セキュアコンテキスト（HTTPS / localhost）でないとカメラは使えない
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      const insecure = !window.isSecureContext;
      setError(
        insecure
          ? `カメラは HTTPS または localhost でのみ使用できます（現在: ${location.protocol}//${location.host}）。スマホ/タブレットからLANのIPアドレスで開いている場合は、HTTPS化が必要です。下の「手動で貼り付け」もご利用いただけます。`
          : "このブラウザ/環境ではカメラ(getUserMedia)を利用できません。下の「手動で貼り付け」をご利用ください。",
      );
      setPhase("error");
      setShowManual(true);
      return;
    }

    setPhase("scanning");

    let zxing: typeof import("@zxing/library");
    try {
      zxing = await import("@zxing/library");
    } catch {
      setError("スキャナの読み込みに失敗しました。手動貼り付けをご利用ください。");
      setPhase("error");
      setShowManual(true);
      return;
    }

    const {
      BrowserQRCodeReader,
      ResultMetadataType,
      DecodeHintType,
    } = zxing;
    const SEQ = ResultMetadataType.STRUCTURED_APPEND_SEQUENCE;
    const PARITY = ResultMetadataType.STRUCTURED_APPEND_PARITY;
    const BYTE_SEGMENTS = ResultMetadataType.BYTE_SEGMENTS;

    const hints = new Map<ZXHintType, unknown>();
    hints.set(DecodeHintType.TRY_HARDER, true);

    const video = videoRef.current;
    if (!video) return;

    const reader = new BrowserQRCodeReader();
    reader.hints = hints; // BrowserQRCodeReader ctor は hints を受けないためプロパティで設定
    readerRef.current = reader;

    try {
      await reader.decodeFromConstraints(
        { video: { facingMode: "environment" } },
        video,
        (result?: ZXResult) => {
          if (!result) return;
          const meta = result.getResultMetadata?.();
          const seq = meta?.get(SEQ) as number | undefined;
          const parity = meta?.get(PARITY) as number | undefined;
          const bytes = bytesFromResult(result, BYTE_SEGMENTS);

          if (seq === undefined || seq < 0) {
            // 分割なし（単一QR）: そのまま復号
            ingestText(new TextDecoder("shift_jis").decode(bytes));
          } else {
            const pos = (seq >> 4) & 0x0f; // 上位4bit = 位置
            const key = `p${parity}`;
            let g = fragsRef.current.get(key);
            if (!g) {
              g = new Map();
              fragsRef.current.set(key, g);
            }
            g.set(pos, bytes);
            ingestText(assembleGroup(g));
          }

          // コード2・コード3 が両方そろったら自動的に確認へ
          if (capturedRef.current.code2 && capturedRef.current.code3) {
            finalize();
          }
        },
      );
    } catch (e) {
      const name = (e as { name?: string } | null)?.name ?? "";
      const msg =
        name === "NotAllowedError"
          ? "カメラの使用が許可されませんでした。ブラウザの権限設定をご確認ください。"
          : name === "NotFoundError"
            ? "カメラが見つかりませんでした。手動貼り付けをご利用ください。"
            : "カメラを起動できませんでした。手動貼り付けをご利用ください。";
      setError(msg);
      setPhase("error");
      setShowManual(true);
    }
  }, [finalize, ingestText]);

  const cancel = useCallback(() => {
    stop();
    setPhase("idle");
    setError(null);
  }, [stop]);

  const applyManual = useCallback(() => {
    // 改行区切りで複数行貼り付け可。各行をコード2/3 判定して取り込む。
    capturedRef.current = {};
    for (const line of manual.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      const kind = classifyCode(t);
      if (kind !== "unknown") capturedRef.current[kind] = t;
    }
    setCaptured({ ...capturedRef.current });
    if (!capturedRef.current.code2 && !capturedRef.current.code3) {
      setError("有効な二次元コード文字列が見つかりませんでした（項目数が6または21である必要があります）。");
      return;
    }
    setError(null);
    setPhase("confirm");
  }, [manual]);

  const confirmApply = useCallback(() => {
    const raw = capturedRef.current;
    const info = mergeShaken(
      raw.code2 ? parseCode2(raw.code2) : {},
      raw.code3 ? parseCode3(raw.code3) : {},
    );
    onParsed(info, { ...raw });
    setPhase("idle");
    setCaptured({});
    capturedRef.current = {};
  }, [onParsed]);

  const mergedPreview = mergeShaken(
    captured.code2 ? parseCode2(captured.code2) : {},
    captured.code3 ? parseCode3(captured.code3) : {},
  );

  return (
    <div className={`rounded-xl border border-line bg-surface p-3 ${className ?? ""}`}>
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-sm font-bold text-ink">車検証から車両情報を読み取る</p>
          <p className="text-xs text-ink-soft">
            <span className="font-semibold text-ink">PDF（車検証閲覧アプリ）がいちばん確実です</span>
            。いまのA6の電子車検証は券面の記載が省略されており、二次元コードにも有効期間・氏名・住所が入っていません。
          </p>
        </div>
        {phase === "idle" && (
          <Button type="button" variant="secondary" onClick={startScan}>
            QRを読む
          </Button>
        )}
        {(phase === "scanning" || phase === "error") && (
          <Button type="button" variant="secondary" onClick={cancel}>
            閉じる
          </Button>
        )}
      </div>

      {/* PDF/写真の入口。iPhoneでは accept に image/* を混ぜるとPDFを選びにくいので分ける */}
      {phase === "idle" && (
        <div className="mt-2">
          <input
            ref={pdfRef}
            type="file"
            accept="application/pdf,.pdf"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void readFile(f);
            }}
          />
          <button
            type="button"
            disabled={pdfReading}
            onClick={() => pdfRef.current?.click()}
            className="rounded-lg bg-gold-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
          >
            {pdfReading ? "読み取り中…" : "📄 車検証PDFを選ぶ（推奨）"}
          </button>
          {pdfNote && <p className="mt-2 text-xs font-semibold text-green-700">{pdfNote}</p>}
          {pdfError && <p className="mt-2 text-xs font-semibold text-red-600">{pdfError}</p>}
          <p className="mt-1.5 text-[11px] text-ink-soft">
            iPhoneは「車検証閲覧アプリ」で共有 →「ファイルに保存」してから選んでください（iOSの仕様で共有先にこのアプリを出せません）。
            車検証のPDF・画像は保存されません。
          </p>
        </div>
      )}

      {/* スキャン中 */}
      {phase === "scanning" && (
        <div className="mt-3 space-y-2">
          <video
            ref={videoRef}
            className="w-full rounded-lg bg-black object-cover"
            style={{ aspectRatio: "4 / 3" }}
            muted
            playsInline
          />
          <div className="flex items-center gap-3 text-xs">
            <span className={captured.code2 ? "font-semibold text-green-700" : "text-ink-soft"}>
              {captured.code2 ? "✓ " : "□ "}コード2（車台番号・ナンバー）
            </span>
            <span className={captured.code3 ? "font-semibold text-green-700" : "text-ink-soft"}>
              {captured.code3 ? "✓ " : "□ "}コード3（型式・初度登録）
            </span>
          </div>
          <p className="text-xs text-ink-soft">
            券面の二次元コードにカメラを向けてください。コード2は2枚、コード3は3枚に分割されています。
          </p>
          {(captured.code2 || captured.code3) && (
            <Button type="button" onClick={finalize}>
              読めた分で確定
            </Button>
          )}
        </div>
      )}

      {/* エラー */}
      {phase === "error" && error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
      )}

      {/* 確認 */}
      {phase === "confirm" && (
        <div className="mt-3 space-y-3">
          <p className="text-sm font-semibold text-ink">読み取り結果の確認</p>
          <dl className="divide-y divide-line rounded-lg border border-line px-3">
            <PreviewRow label="車台番号(VIN)" value={mergedPreview.vin} />
            <PreviewRow label="ナンバー" value={mergedPreview.registrationNumber} />
            <PreviewRow label="型式" value={mergedPreview.vehicleModelCode} />
            <PreviewRow label="原動機型式" value={mergedPreview.engineModelCode} />
            <PreviewRow label="型式指定番号・類別区分番号" value={mergedPreview.modelDesignationNumber} />
            <PreviewRow label="初度登録" value={mergedPreview.firstRegistration} />
            <PreviewRow label="有効期限" value={mergedPreview.inspectionExpiry} />
            <PreviewRow label="燃料" value={mergedPreview.fuel} />
          </dl>
          {!mergedPreview.inspectionExpiry && (
            <p className="text-xs text-ink-soft">
              ※ 電子車検証の券面コードでは有効期限は取得できません（空欄）。
            </p>
          )}
          <details className="text-xs text-ink-soft">
            <summary className="cursor-pointer">生データを表示</summary>
            <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded bg-gray-50 p-2 font-mono text-[11px]">
              {`code2: ${captured.code2 ?? "(未取得)"}\ncode3: ${captured.code3 ?? "(未取得)"}`}
            </pre>
          </details>
          <div className="flex gap-2">
            <Button type="button" onClick={confirmApply}>
              この内容で入力
            </Button>
            <Button type="button" variant="secondary" onClick={startScan}>
              やり直す
            </Button>
          </div>
        </div>
      )}

      {/* 手動貼り付け（カメラ不可時・検証用） */}
      {phase !== "confirm" && (
        <div className="mt-3 border-t border-line pt-2">
          <button
            type="button"
            className="text-xs text-ink-soft underline"
            onClick={() => setShowManual((v) => !v)}
          >
            手動で貼り付け（カメラが使えないとき）
          </button>
          {showManual && (
            <div className="mt-2 space-y-2">
              <textarea
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                rows={3}
                placeholder="コード2・コード3 の生文字列を改行区切りで貼り付け"
                className="block w-full rounded-lg border border-line px-3 py-2 font-mono text-xs"
              />
              <Button type="button" variant="secondary" onClick={applyManual}>
                解析する
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function PreviewRow({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex justify-between gap-3 py-1.5">
      <dt className="shrink-0 text-xs text-ink-soft">{label}</dt>
      <dd className="text-right text-sm font-medium text-ink">{value || "—"}</dd>
    </div>
  );
}
