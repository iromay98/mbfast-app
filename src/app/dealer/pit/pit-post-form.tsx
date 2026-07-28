"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileDropZone } from "@/components/file-drop-zone";
import { ShakenQrScanner, chassisFromQrText } from "@/components/shaken-qr-scanner";
import { PlateMosaicEditor } from "@/components/plate-mosaic-editor";
import {
  detectPlates,
  drawWithBlur,
  preloadPlateModel,
  type PlateBox,
} from "@/lib/plate-detect";

// 写真1枚分のぼかし編集状態
type PhotoItem = {
  file: File;
  url: string; // objectURL（端末内のみ）
  boxes: PlateBox[];
  previewUrl: string | null; // ぼかし適用後のサムネイル
  detecting: boolean;
};

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

// ぼかし適用後のサムネイル（240px）を生成
async function makePreview(item: PhotoItem): Promise<string> {
  const img = await loadImage(item.url);
  const scale = Math.min(1, 240 / img.naturalWidth);
  const c = document.createElement("canvas");
  c.width = Math.round(img.naturalWidth * scale);
  c.height = Math.round(img.naturalHeight * scale);
  const ctx = c.getContext("2d")!;
  ctx.scale(scale, scale);
  drawWithBlur(ctx, img, img.naturalWidth, img.naturalHeight, item.boxes);
  return c.toDataURL("image/jpeg", 0.8);
}

// ぼかし適用済みのフル解像度JPEGを書き出す（これだけがサーバーへ送られる）
async function exportMosaicked(item: PhotoItem): Promise<Blob> {
  const img = await loadImage(item.url);
  const c = document.createElement("canvas");
  c.width = img.naturalWidth;
  c.height = img.naturalHeight;
  const ctx = c.getContext("2d")!;
  drawWithBlur(ctx, img, img.naturalWidth, img.naturalHeight, item.boxes);
  return new Promise((resolve, reject) =>
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("export failed"))), "image/jpeg", 0.92),
  );
}

// 投稿成功時に返るゲーミフィケーション統計
type PitStats = {
  total: number;
  month: number;
  lastMonth: number;
  streakWeeks: number;
  badge: { name: string; emoji: string } | null;
  next: { name: string; remaining: number } | null;
  rank: number | null;
  storeCount: number;
};

// ゴールドのカウントアップ演出
function CountUp({ to }: { to: number }) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (to <= 0) return;
    const steps = Math.min(to, 24);
    let i = 0;
    const iv = setInterval(() => {
      i++;
      if (i >= steps) {
        setN(to);
        clearInterval(iv);
      } else {
        setN(Math.round((to * i) / steps));
      }
    }, 45);
    return () => clearInterval(iv);
  }, [to]);
  return <>{n}</>;
}

// Web Speech API の最小型（TS標準libに無いため。Chrome/Edge/Android は webkitSpeechRecognition）
type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult:
    | ((e: {
        resultIndex: number;
        results: { length: number; [i: number]: { isFinal: boolean; 0: { transcript: string } } };
      }) => void)
    | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  start(): void;
  stop(): void;
};

function getSpeechRecognition(): (new () => SpeechRecognitionLike) | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return (w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null) as
    | (new () => SpeechRecognitionLike)
    | null;
}

// 送信中に順番に見せる進捗メッセージ（実際の処理段階に対応）
const LOADING_STEPS = [
  "音声メモと写真を確認しています…",
  "写真を最適化しています（WebP変換）…",
  "AIが記事を執筆しています…",
  "ブログに公開しています…",
];

const CATEGORIES: { value: string; label: string }[] = [
  { value: "ecu", label: "ECUチューニング" },
  { value: "coating", label: "コーティング" },
  { value: "polish", label: "磨き" },
  { value: "maintenance", label: "メンテナンス" },
  { value: "other", label: "その他" },
];

// 店舗の投稿フォーム。入力は最小限（写真・車種・カテゴリ・任意メモ）。
// 送信 → サーバーでAI記事化＋WordPress公開 → 完了画面で公開URLを表示。
// storeId: 本部が任意の店舗として投稿する場合のみ指定（代理店はセッションから解決されるので不要）
export function PitPostForm({ storeId }: { storeId?: string } = {}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<
    | { kind: "published"; url: string; title: string; stats: PitStats | null; vehicleLinked: boolean }
    | { kind: "held"; message: string }
    | null
  >(null);
  const formRef = useRef<HTMLFormElement>(null);

  // ── ナンバープレートぼかし（ブラウザ内処理・生画像はサーバーに送らない） ──
  const [photoItems, setPhotoItems] = useState<PhotoItem[]>([]);
  const [editorIdx, setEditorIdx] = useState<number | null>(null);
  const [modelReady, setModelReady] = useState<boolean | null>(null); // null=判定中

  useEffect(() => {
    // 投稿UI表示時に検出モデルを非同期プリロード（未設置ならmanualのみ）
    void preloadPlateModel().then((l) => setModelReady(!!l));
  }, []);

  const handleFiles = (files: File[]) => {
    setPhotoItems((old) => {
      old.forEach((o) => URL.revokeObjectURL(o.url));
      return files
        .filter((f) => f.type.startsWith("image/"))
        .map((f) => ({
          file: f,
          url: URL.createObjectURL(f),
          boxes: [],
          previewUrl: null,
          detecting: true,
        }));
    });
    // 各写真を自動検出（モデルがあれば）→ サムネイル生成
    files.forEach((f, idx) => {
      void (async () => {
        let boxes: PlateBox[] = [];
        try {
          const url = URL.createObjectURL(f);
          const img = await loadImage(url);
          const det = await detectPlates(img, img.naturalWidth, img.naturalHeight);
          boxes = det ?? [];
          URL.revokeObjectURL(url);
        } catch {
          boxes = [];
        }
        setPhotoItems((items) => {
          if (!items[idx] || items[idx].file !== f) return items;
          const next = [...items];
          next[idx] = { ...next[idx], boxes, detecting: false };
          void makePreview(next[idx]).then((p) =>
            setPhotoItems((cur) => {
              if (!cur[idx] || cur[idx].file !== f) return cur;
              const n2 = [...cur];
              n2[idx] = { ...n2[idx], previewUrl: p };
              return n2;
            }),
          );
          return next;
        });
      })();
    });
  };

  const saveBoxes = (idx: number, boxes: PlateBox[]) => {
    setPhotoItems((items) => {
      const next = [...items];
      next[idx] = { ...next[idx], boxes };
      void makePreview(next[idx]).then((p) =>
        setPhotoItems((cur) => {
          const n2 = [...cur];
          if (n2[idx]) n2[idx] = { ...n2[idx], previewUrl: p };
          return n2;
        }),
      );
      return next;
    });
    setEditorIdx(null);
  };

  // ── 車検証QR（お薬手帳への車両紐づけ・任意） ──
  const [scanning, setScanning] = useState(false);
  const [qrText, setQrText] = useState<string | null>(null);
  const [chassisManual, setChassisManual] = useState("");
  const [showManualChassis, setShowManualChassis] = useState(false);
  const chassisValue = qrText ?? (chassisManual.trim() || "");
  const chassisDisplay = qrText ? chassisFromQrText(qrText) : chassisManual.trim() || null;
  const chassisLast3 = chassisDisplay ? chassisDisplay.replace(/[^0-9]/g, "").slice(-3) : null;

  // ── 音声入力（Web Speech API・対応ブラウザのみマイクボタンを表示） ──
  const [memo, setMemo] = useState("");
  const [interim, setInterim] = useState("");
  const [recording, setRecording] = useState(false);
  const [speechOk, setSpeechOk] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);

  useEffect(() => {
    setSpeechOk(getSpeechRecognition() !== null);
    return () => recRef.current?.stop();
  }, []);

  // 送信中の進捗メッセージを順送り
  const [loadStep, setLoadStep] = useState(0);
  useEffect(() => {
    if (!busy) return;
    setLoadStep(0);
    const iv = setInterval(() => setLoadStep((s) => Math.min(s + 1, LOADING_STEPS.length - 1)), 12000);
    return () => clearInterval(iv);
  }, [busy]);

  const toggleVoice = () => {
    if (recording) {
      recRef.current?.stop();
      return;
    }
    const Ctor = getSpeechRecognition();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = "ja-JP";
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      let interimText = "";
      let finalText = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript;
        else interimText += r[0].transcript;
      }
      if (finalText) setMemo((m) => (m + finalText).slice(0, 1000));
      setInterim(interimText);
    };
    rec.onend = () => {
      setRecording(false);
      setInterim("");
      recRef.current = null;
    };
    rec.onerror = () => {
      setRecording(false);
      setInterim("");
    };
    recRef.current = rec;
    setRecording(true);
    rec.start();
  };

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError(null);
    setDone(null);
    const form = new FormData(e.currentTarget);
    const photos = form.getAll("photos").filter((f) => f instanceof File && f.size > 0);
    if (photos.length === 0 && photoItems.length === 0) {
      setError("写真を1枚以上追加してください");
      return;
    }
    setBusy(true);
    // ぼかし適用済み画像に差し替えてから送信（未加工のナンバーをサーバーに送らない）
    try {
      if (photoItems.length > 0) {
        form.delete("photos");
        for (const item of photoItems) {
          if (item.boxes.length > 0) {
            const blob = await exportMosaicked(item);
            form.append("photos", blob, item.file.name.replace(/\.[^.]+$/, "") + "-blur.jpg");
          } else {
            form.append("photos", item.file);
          }
        }
      }
    } catch {
      setBusy(false);
      setError("画像の処理に失敗しました。もう一度お試しください。");
      return;
    }
    try {
      if (storeId) form.set("storeId", storeId);
      const res = await fetch("/api/pit/posts", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as {
        status?: string;
        url?: string;
        title?: string;
        message?: string;
        error?: string;
        stats?: PitStats | null;
        vehicleLinked?: boolean;
      };
      if (data.status === "published" && data.url) {
        setDone({
          kind: "published",
          url: data.url,
          title: data.title ?? "",
          stats: data.stats ?? null,
          vehicleLinked: !!data.vehicleLinked,
        });
        formRef.current?.reset();
        setMemo("");
        setQrText(null);
        setChassisManual("");
        photoItems.forEach((it) => URL.revokeObjectURL(it.url));
        setPhotoItems([]);
        router.refresh();
      } else if (data.status === "held") {
        setDone({ kind: "held", message: data.message ?? "本部確認となりました。" });
        formRef.current?.reset();
        setMemo("");
        photoItems.forEach((it) => URL.revokeObjectURL(it.url));
        setPhotoItems([]);
        router.refresh();
      } else {
        setError(data.error ?? "送信に失敗しました。時間をおいて再度お試しください。");
      }
    } catch {
      setError("通信エラーが発生しました。電波の良い場所で再度お試しください。");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="space-y-3 py-2 text-center">
        {done.kind === "published" ? (
          <>
            <p className="text-3xl">🎉</p>
            <p className="text-sm font-bold">記事を公開しました！</p>
            {done.title && <p className="text-xs text-ink-soft">{done.title}</p>}
            <a
              href={done.url}
              target="_blank"
              rel="noopener"
              className="inline-block rounded-full bg-gold-500 px-5 py-2.5 text-sm font-bold text-white shadow-sm hover:bg-gold-600"
            >
              記事を見る
            </a>

            {/* ゴールド演出: +1記録 と カウントアップ */}
            {done.stats && (
              <div className="mx-auto mt-3 max-w-sm rounded-2xl border border-gold-200 bg-gold-50 p-4 text-center">
                <p className="text-[11px] font-extrabold tracking-widest text-gold-600">＋1 記録</p>
                <div className="mt-2 flex items-end justify-center gap-8">
                  <div>
                    <div className="text-3xl font-black text-gold-600">
                      <CountUp to={done.stats.total} />
                    </div>
                    <div className="text-[10px] font-semibold text-ink-soft">通算記録</div>
                  </div>
                  <div>
                    <div className="text-3xl font-black text-ink">
                      <CountUp to={done.stats.month} />
                    </div>
                    <div className="text-[10px] font-semibold text-ink-soft">今月</div>
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap items-center justify-center gap-2 text-[11px] font-bold">
                  {done.stats.streakWeeks > 0 && (
                    <span className="rounded-full bg-orange-100 px-2.5 py-1 text-orange-700">
                      🔥 {done.stats.streakWeeks}週連続投稿中
                    </span>
                  )}
                  {done.stats.badge && (
                    <span className="rounded-full bg-gold-100 px-2.5 py-1 text-gold-700">
                      {done.stats.badge.emoji} {done.stats.badge.name}店
                    </span>
                  )}
                  {done.vehicleLinked && (
                    <span className="rounded-full bg-sky-100 px-2.5 py-1 text-sky-700">
                      🚗 お薬手帳に記録
                    </span>
                  )}
                </div>
                {done.stats.next && (
                  <p className="mt-2 text-[10px] text-ink-soft">
                    次の称号「{done.stats.next.name}」まで あと{done.stats.next.remaining}件
                  </p>
                )}
                <p className="mt-1 text-[10px] text-ink-soft">
                  先月{done.stats.lastMonth}件 → 今月{done.stats.month}件
                  {done.stats.rank && done.stats.storeCount > 1
                    ? `（今月の投稿数: 加盟${done.stats.storeCount}店中 ${done.stats.rank}位）`
                    : ""}
                </p>
              </div>
            )}
          </>
        ) : (
          <>
            <p className="text-3xl">🕐</p>
            <p className="text-sm font-bold">本部確認となりました</p>
            <p className="text-xs text-ink-soft">{done.message}</p>
          </>
        )}
        <div>
          <button type="button" onClick={() => setDone(null)} className="text-xs text-sky-700 underline">
            続けて投稿する
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      {/* 送信中: フォームを隠して進捗を見せる（AI解析中スピナー） */}
      {busy && (
        <div className="space-y-3 py-10 text-center">
          <div className="mx-auto h-11 w-11 animate-spin rounded-full border-4 border-line border-t-gold-500" />
          <p className="text-sm font-bold text-ink">AIが記事を作成中…</p>
          <p className="text-xs text-ink-soft">{LOADING_STEPS[loadStep]}</p>
          <p className="text-[11px] text-ink-soft">1〜3分ほどかかります。画面を閉じずにお待ちください。</p>
        </div>
      )}

      <form ref={formRef} onSubmit={submit} className={busy ? "hidden" : "space-y-4"}>
        {/* ── 音声入力ゾーン（大きなマイクボタン） ── */}
        <div className="pt-1 text-center">
          <p className="text-sm font-extrabold text-ink">🎤 今日の作業を話してください</p>
          {speechOk ? (
            <>
              <div className="relative mx-auto mt-4 h-24 w-24">
                {recording && (
                  <span className="absolute inset-0 animate-ping rounded-full bg-red-400 opacity-60" />
                )}
                <button
                  type="button"
                  onClick={toggleVoice}
                  className={`relative h-24 w-24 rounded-full text-4xl text-white shadow-lg transition ${
                    recording
                      ? "bg-red-600"
                      : "bg-gradient-to-br from-gold-400 to-gold-600 hover:from-gold-500 hover:to-gold-700"
                  }`}
                  aria-label={recording ? "録音停止" : "音声入力を開始"}
                >
                  {recording ? "■" : "🎤"}
                </button>
              </div>
              <p className="mt-3 text-[11px] leading-relaxed text-ink-soft">
                {recording ? (
                  "録音中… もう一度タップで停止"
                ) : (
                  <>
                    タップして話す（30秒でOK）
                    <br />
                    例:「アルファードのコーティング施工。撥水がしっかり出る仕上がりです」
                  </>
                )}
              </p>
            </>
          ) : (
            <p className="mt-2 text-[11px] leading-relaxed text-ink-soft">
              このブラウザは音声認識に対応していません。
              <br />
              下の入力欄で<b>キーボードのマイク（音声入力）</b>が使えます。
            </p>
          )}
        </div>

        <textarea
          name="memo"
          rows={4}
          maxLength={1000}
          value={memo + interim}
          onChange={(e) => {
            setMemo(e.target.value);
            setInterim("");
          }}
          placeholder="音声認識の結果がここに入ります。手入力・修正もOK（任意。空でもAIが写真から記事を作ります）"
          className={`w-full rounded-xl border bg-surface px-3 py-2.5 text-sm leading-relaxed ${
            recording ? "border-red-400" : "border-line"
          }`}
        />

        {/* ── 写真 ── */}
        <div>
          <label className="mb-1 block text-xs font-semibold">
            写真（1〜10枚） <span className="text-red-600">必須</span>
          </label>
          <FileDropZone
            name="photos"
            required
            multiple
            accept="image/*"
            prompt="写真をここにドラッグ＆ドロップ"
            onFiles={handleFiles}
          />
          <p className="mt-1 text-[11px] text-ink-soft">
            お客様のお顔や書類が写り込んでいない写真を選んでください。
          </p>

          {/* ナンバーぼかし: サムネイルをタップして確認・修正 */}
          {photoItems.length > 0 && (
            <div className="mt-2 rounded-xl border border-line bg-surface-2 p-2.5">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-semibold">
                  🖌 ナンバープレートのぼかし
                  {modelReady === false && (
                    <span className="ml-1 font-normal text-ink-soft">（自動検出は準備中・手動で指定できます）</span>
                  )}
                </p>
              </div>
              <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
                {photoItems.map((item, i) => (
                  <button
                    key={item.url}
                    type="button"
                    onClick={() => setEditorIdx(i)}
                    className="relative shrink-0"
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.previewUrl ?? item.url}
                      alt=""
                      className="h-20 w-20 rounded-lg border border-line object-cover"
                    />
                    <span
                      className={`absolute bottom-1 right-1 rounded-full px-1.5 py-0.5 text-[9px] font-bold text-white ${
                        item.detecting
                          ? "bg-sky-600"
                          : item.boxes.length > 0
                            ? "bg-green-600"
                            : "bg-black/60"
                      }`}
                    >
                      {item.detecting ? "検出中…" : item.boxes.length > 0 ? `🖌 ${item.boxes.length}` : "編集"}
                    </span>
                  </button>
                ))}
              </div>
              <p className="mt-1 text-[10px] leading-relaxed text-ink-soft">
                ぼかしは送信前にこの端末内で合成されます（未加工の写真はサーバーに送られません）。サムネイルをタップすると追加・解除できます。
              </p>
            </div>
          )}
        </div>

        {/* ── 車種・施工内容 ── */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-xs font-semibold">
              車種 <span className="text-red-600">必須</span>
            </label>
            <input
              name="vehicle"
              required
              placeholder="例: アルファード 30系"
              className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold">
              施工内容 <span className="text-red-600">必須</span>
            </label>
            <select name="category" className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm">
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* ── 車検証QR（お薬手帳・任意） ── */}
        <div className="rounded-xl border border-line bg-surface-2 p-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold">🚗 車のお薬手帳に記録（任意）</p>
            {chassisLast3 && (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700">
                ✓ 車台番号 下3桁 ***{chassisLast3}
              </span>
            )}
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-soft">
            車検証のQRを読み取ると、この記録がお客様のマイカーページ（施工履歴・施工証明書）に紐づきます。
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => setScanning(true)}
              className="rounded-lg border border-gold-300 bg-white px-3 py-1.5 text-xs font-bold text-gold-700"
            >
              📄 車検証QRをスキャン
            </button>
            <button
              type="button"
              onClick={() => setShowManualChassis((v) => !v)}
              className="rounded-lg border border-line px-3 py-1.5 text-xs text-ink-soft"
            >
              手入力
            </button>
          </div>
          {showManualChassis && (
            <input
              value={chassisManual}
              onChange={(e) => {
                setChassisManual(e.target.value);
                setQrText(null);
              }}
              placeholder="車台番号（例: ZC33S-123456）"
              className="mt-2 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
            />
          )}
          <input type="hidden" name="chassisNo" value={chassisValue} />
        </div>

        {error && <p className="text-xs font-semibold text-red-600">{error}</p>}

        <button
          type="submit"
          className="w-full rounded-full bg-gold-500 px-4 py-3.5 text-sm font-extrabold text-white shadow-sm hover:bg-gold-600"
        >
          AIにおまかせしてブログ公開 →
        </button>
      </form>

      {scanning && (
        <ShakenQrScanner
          onText={(text) => {
            if (chassisFromQrText(text)) {
              setQrText(text);
              setScanning(false);
              return true;
            }
            return false;
          }}
          onClose={() => setScanning(false)}
        />
      )}

      {editorIdx !== null && photoItems[editorIdx] && (
        <PlateMosaicEditor
          src={photoItems[editorIdx].url}
          initialBoxes={photoItems[editorIdx].boxes}
          onSave={(boxes) => saveBoxes(editorIdx, boxes)}
          onClose={() => setEditorIdx(null)}
        />
      )}
    </>
  );
}
