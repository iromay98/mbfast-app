"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

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
  const [photoCount, setPhotoCount] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);

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
        setPhotoCount(0);
        router.refresh();
      } else if (data.status === "held") {
        setDone({ kind: "held", message: data.message ?? "本部確認となりました。" });
        formRef.current?.reset();
        setPhotoCount(0);
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
    <form ref={formRef} onSubmit={submit} className="space-y-3">
      <div>
        <label className="mb-1 block text-xs font-semibold">
          写真（1〜10枚） <span className="text-red-600">必須</span>
        </label>
        <input
          name="photos"
          type="file"
          accept="image/*"
          multiple
          required
          disabled={busy}
          onChange={(e) => setPhotoCount(e.target.files?.length ?? 0)}
          className="w-full text-xs"
        />
        {photoCount > 0 && <p className="mt-1 text-[11px] text-ink-soft">{photoCount}枚選択中</p>}
        <p className="mt-1 text-[11px] text-ink-soft">
          お客様のお顔や書類が写り込んでいない写真を選んでください。
        </p>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold">
          車種 <span className="text-red-600">必須</span>
        </label>
        <input
          name="vehicle"
          required
          disabled={busy}
          placeholder="例: アルファード 30系"
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
        />
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold">
          施工内容 <span className="text-red-600">必須</span>
        </label>
        <select name="category" disabled={busy} className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm">
          {CATEGORIES.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="mb-1 block text-xs font-semibold">メモ（任意・500文字まで）</label>
        <textarea
          name="memo"
          rows={3}
          maxLength={500}
          disabled={busy}
          placeholder="施工のポイントや仕上がりの様子など（書かなくてもOK。AIが写真から記事を作ります）"
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
        />
      </div>

      {error && <p className="text-xs font-semibold text-red-600">{error}</p>}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-full bg-gold-500 px-4 py-3 text-sm font-bold text-white shadow-sm hover:bg-gold-600 disabled:opacity-60"
      >
        {busy ? "記事を作成中…（1〜3分ほどかかります。画面を閉じずにお待ちください）" : "送信してブログに公開"}
      </button>
    </form>
  );
}
