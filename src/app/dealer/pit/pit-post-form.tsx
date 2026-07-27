"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { FileDropZone } from "@/components/file-drop-zone";

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
export function PitPostForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ kind: "published"; url: string; title: string } | { kind: "held"; message: string } | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

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
    if (photos.length === 0) {
      setError("写真を1枚以上追加してください");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/pit/posts", { method: "POST", body: form });
      const data = (await res.json().catch(() => ({}))) as {
        status?: string;
        url?: string;
        title?: string;
        message?: string;
        error?: string;
      };
      if (data.status === "published" && data.url) {
        setDone({ kind: "published", url: data.url, title: data.title ?? "" });
        formRef.current?.reset();
        setMemo("");
        router.refresh();
      } else if (data.status === "held") {
        setDone({ kind: "held", message: data.message ?? "本部確認となりました。" });
        formRef.current?.reset();
        setMemo("");
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
          />
          <p className="mt-1 text-[11px] text-ink-soft">
            お客様のお顔や書類が写り込んでいない写真を選んでください。
          </p>
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

        {error && <p className="text-xs font-semibold text-red-600">{error}</p>}

        <button
          type="submit"
          className="w-full rounded-full bg-gold-500 px-4 py-3.5 text-sm font-extrabold text-white shadow-sm hover:bg-gold-600"
        >
          AIにおまかせしてブログ公開 →
        </button>
      </form>
    </>
  );
}
