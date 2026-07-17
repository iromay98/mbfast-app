"use client";

import { useEffect, useRef, useState } from "react";
import { Card, Button, Field, Input, Textarea, Select, FormError } from "@/components/ui";
import { PIT_CATEGORIES, PIT_CATEGORY_LABELS } from "@/lib/pit-labels";

/*
 * mbPIT 投稿フォーム（クライアント）。
 * 送信 → ローディング → 完了画面で公開URLを表示。
 * 記事化はサーバー側バックグラウンドのため、受付後は状態APIをポーリングする。
 */

const MAX_PHOTOS = 10;
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5分で打ち切り（サーバー側は継続）

type Phase =
  | { kind: "form" }
  | { kind: "submitting" }
  | { kind: "processing"; postId: string }
  | { kind: "done"; url: string; title: string | null }
  | { kind: "held"; message: string }
  | { kind: "failed"; message: string };

type StatusRes = {
  status: "PROCESSING" | "PUBLISHED" | "HELD" | "FAILED";
  publishedUrl: string | null;
  title: string | null;
  message: string;
};

export function PitPostForm() {
  const [photos, setPhotos] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  // プレビューURLの解放
  useEffect(() => () => previews.forEach((u) => URL.revokeObjectURL(u)), [previews]);

  // 処理中はポーリングで状態を追う
  useEffect(() => {
    if (phase.kind !== "processing") return;
    const startedAt = Date.now();
    const timer = setInterval(async () => {
      if (Date.now() - startedAt > POLL_TIMEOUT_MS) {
        clearInterval(timer);
        setPhase({
          kind: "failed",
          message:
            "処理に時間がかかっています。しばらくしてから「最近の投稿」で公開状況を確認してください。",
        });
        return;
      }
      try {
        const res = await fetch(`/api/pit/posts/${phase.postId}`, { cache: "no-store" });
        if (!res.ok) return; // 一時的な失敗はリトライ
        const data = (await res.json()) as StatusRes;
        if (data.status === "PUBLISHED" && data.publishedUrl) {
          clearInterval(timer);
          setPhase({ kind: "done", url: data.publishedUrl, title: data.title });
        } else if (data.status === "HELD") {
          clearInterval(timer);
          setPhase({ kind: "held", message: data.message });
        } else if (data.status === "FAILED") {
          clearInterval(timer);
          setPhase({ kind: "failed", message: data.message });
        }
      } catch {
        // ネットワーク一時障害はリトライ
      }
    }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [phase]);

  function addPhotos(files: FileList | null) {
    if (!files) return;
    setError(null);
    const next = [...photos];
    const nextPreviews = [...previews];
    for (const f of Array.from(files)) {
      if (next.length >= MAX_PHOTOS) {
        setError(`写真は${MAX_PHOTOS}枚までです`);
        break;
      }
      next.push(f);
      nextPreviews.push(URL.createObjectURL(f));
    }
    setPhotos(next);
    setPreviews(nextPreviews);
  }

  function removePhoto(i: number) {
    URL.revokeObjectURL(previews[i]);
    setPhotos(photos.filter((_, idx) => idx !== i));
    setPreviews(previews.filter((_, idx) => idx !== i));
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (photos.length === 0) {
      setError("写真を1枚以上追加してください");
      return;
    }
    const form = e.currentTarget;
    const fd = new FormData();
    photos.forEach((p) => fd.append("photos", p));
    fd.set("vehicle", (form.elements.namedItem("vehicle") as HTMLInputElement).value);
    fd.set("category", (form.elements.namedItem("category") as HTMLSelectElement).value);
    fd.set("memo", (form.elements.namedItem("memo") as HTMLTextAreaElement).value);

    setPhase({ kind: "submitting" });
    try {
      const res = await fetch("/api/pit/posts", { method: "POST", body: fd });
      const data = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
      if (!res.ok || !data.id) {
        setPhase({ kind: "form" });
        setError(data.error ?? "送信に失敗しました。通信環境を確認して再度お試しください");
        return;
      }
      setPhase({ kind: "processing", postId: data.id });
    } catch {
      setPhase({ kind: "form" });
      setError("送信に失敗しました。通信環境を確認して再度お試しください");
    }
  }

  function reset() {
    previews.forEach((u) => URL.revokeObjectURL(u));
    setPhotos([]);
    setPreviews([]);
    setError(null);
    setPhase({ kind: "form" });
    formRef.current?.reset();
  }

  // ── 完了/保留/失敗/処理中の画面 ──────────────────
  if (phase.kind === "processing" || phase.kind === "submitting") {
    return (
      <Card className="text-center">
        <div className="mx-auto my-6 h-10 w-10 animate-spin rounded-full border-4 border-gold-200 border-t-gold-500" />
        <p className="text-sm font-semibold text-ink">
          {phase.kind === "submitting" ? "写真を送信しています…" : "記事を作成しています…"}
        </p>
        <p className="mt-1 text-xs text-ink-soft">
          ナンバープレートのぼかし・記事の生成・公開まで自動で行います（数分かかることがあります）
        </p>
      </Card>
    );
  }
  if (phase.kind === "done") {
    return (
      <Card className="text-center">
        <p className="my-4 text-2xl">🎉</p>
        <p className="text-sm font-bold text-ink">記事を公開しました！</p>
        {phase.title && <p className="mt-1 text-sm text-ink-soft">{phase.title}</p>}
        <p className="mt-3">
          <a
            href={phase.url}
            target="_blank"
            rel="noopener noreferrer"
            className="break-all text-sm font-semibold text-gold-600 underline"
          >
            {phase.url}
          </a>
        </p>
        <Button className="mt-4" variant="secondary" onClick={reset}>
          続けて投稿する
        </Button>
      </Card>
    );
  }
  if (phase.kind === "held" || phase.kind === "failed") {
    return (
      <Card className="text-center">
        <p className="my-4 text-2xl">{phase.kind === "held" ? "⏸" : "⚠️"}</p>
        <p className="text-sm font-semibold text-ink">{phase.message}</p>
        <Button className="mt-4" variant="secondary" onClick={reset}>
          投稿画面に戻る
        </Button>
      </Card>
    );
  }

  // ── 入力フォーム ────────────────────────────────
  return (
    <Card>
      <form ref={formRef} onSubmit={onSubmit} className="space-y-4">
        <div>
          <span className="mb-1 block text-sm font-medium text-ink">
            写真（1〜{MAX_PHOTOS}枚） <span className="text-red-600">*</span>
          </span>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={(e) => {
              addPhotos(e.target.files);
              e.target.value = "";
            }}
          />
          <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {previews.map((src, i) => (
              <div key={i} className="relative aspect-square overflow-hidden rounded-lg border border-line">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt={`写真${i + 1}`} className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => removePhoto(i)}
                  aria-label={`写真${i + 1}を削除`}
                  className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/60 text-xs text-white"
                >
                  ✕
                </button>
              </div>
            ))}
            {photos.length < MAX_PHOTOS && (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex aspect-square flex-col items-center justify-center rounded-lg border border-dashed border-line text-ink-soft hover:bg-surface-2"
              >
                <span className="text-xl">＋</span>
                <span className="text-[10px]">カメラ/写真</span>
              </button>
            )}
          </div>
          <p className="mt-1 text-xs text-ink-soft">
            ナンバープレートは自動でぼかし処理されます。各10MBまで。
          </p>
        </div>

        <Field label="車種" hint="例: アルファード 30系 / BMW M4 G82">
          <Input name="vehicle" required maxLength={100} placeholder="車種を入力" />
        </Field>

        <Field label="施工内容">
          <Select name="category" required defaultValue="">
            <option value="" disabled>
              選択してください
            </option>
            {PIT_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {PIT_CATEGORY_LABELS[c]}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="メモ（任意）" hint="こだわりポイントや作業内容など。記事の材料になります（500文字以内）">
          <Textarea name="memo" rows={4} maxLength={500} placeholder="例: 下地処理から丁寧に仕上げました" />
        </Field>

        <FormError message={error} />

        <Button type="submit" className="w-full">
          投稿して記事を公開する
        </Button>
        <p className="text-center text-xs text-ink-soft">
          送信後、AIが記事を作成して mbfasttuning.com に自動公開します
        </p>
      </form>
    </Card>
  );
}
