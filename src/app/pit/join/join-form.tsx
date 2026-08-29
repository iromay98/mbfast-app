"use client";

import { useState } from "react";
import { registerPitStore } from "@/lib/actions/pit";

const input =
  "mt-1 block w-full rounded-lg border border-neutral-700 bg-neutral-800 px-3 py-2.5 text-sm text-white placeholder:text-neutral-500 focus:border-[#c9a227] focus:outline-none";
const label = "block text-xs font-semibold text-neutral-300";

// 店舗名からslug候補を作る（英数のみ拾う。日本語店名の場合は自分で入力してもらう）
function suggestSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function JoinForm() {
  const [storeName, setStoreName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ approved: boolean } | null>(null);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const password = String(fd.get("password") ?? "");
    if (password !== String(fd.get("password2") ?? "")) {
      setError("パスワード（確認）が一致しません");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await registerPitStore({
        storeName,
        slug,
        contactName: String(fd.get("contactName") ?? ""),
        email: String(fd.get("email") ?? ""),
        password,
        agreed: fd.get("agree") === "on",
      });
      if (r.error) setError(r.error);
      else setDone({ approved: !!r.approved });
    } catch {
      setError("通信エラーが発生しました。もう一度お試しください");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="rounded-xl border border-[#c9a227]/40 bg-neutral-900 p-5 text-center">
        <div className="text-3xl">🎉</div>
        <h2 className="mt-2 text-base font-bold text-white">登録が完了しました</h2>
        <p className="mt-2 text-xs leading-relaxed text-neutral-300">
          {done.approved ? (
            <>
              登録したメールアドレスとパスワードでログインすると、
              <br />
              今すぐ施工記録の投稿を始められます。
            </>
          ) : (
            <>
              本部が内容を確認し、承認するとブログ投稿が使えるようになります。
              <br />
              承認までしばらくお待ちください。
            </>
          )}
        </p>
        <a
          href="/login"
          className="mt-4 inline-block rounded-lg bg-[#c9a227] px-4 py-2 text-sm font-bold text-black"
        >
          ログイン画面へ
        </a>
        {/* PWA: ホーム画面に追加すればアプリとして使える（ストア配布不要） */}
        <div className="mt-4 rounded-lg border border-neutral-700 bg-neutral-800/60 p-3 text-left">
          <p className="text-xs font-bold text-white">📱 アプリとして使う</p>
          <p className="mt-1 text-[11px] leading-relaxed text-neutral-300">
            ログイン後、このサイトをホーム画面に追加すると毎回アプリのように開けます。
            <br />
            <span className="text-neutral-400">iPhone:</span> Safariの共有ボタン →「ホーム画面に追加」
            <br />
            <span className="text-neutral-400">Android:</span> Chromeのメニュー（⋮）→「アプリをインストール」
          </p>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-xl border border-neutral-700 bg-neutral-900 p-5">
      <h1 className="text-sm font-bold text-white">加盟店登録</h1>
      <p className="text-[11px] leading-relaxed text-neutral-400">
        登録が完了すると、ブログ投稿が利用できるようになります。
      </p>
      <label className={label}>
        店舗名
        <input
          value={storeName}
          onChange={(e) => {
            setStoreName(e.target.value);
            if (!slugTouched) setSlug(suggestSlug(e.target.value));
          }}
          required
          placeholder="例: Blaze Garage"
          className={input}
        />
      </label>
      <label className={label}>
        店舗名の英数字表記（すべて小文字）
        <input
          value={slug}
          onChange={(e) => {
            setSlugTouched(true);
            setSlug(e.target.value.toLowerCase());
          }}
          required
          minLength={3}
          maxLength={40}
          pattern="[a-z0-9-]{3,40}"
          placeholder="例: blaze-garage"
          className={`${input} font-mono`}
        />
        <span className="mt-1 block text-[10px] font-normal text-neutral-500">
          スペースはハイフン（-）に。ブログのURLに使われます（後から変更できません）
        </span>
      </label>
      <label className={label}>
        担当者名
        <input name="contactName" required placeholder="例: 山田 太郎" className={input} />
      </label>
      <label className={label}>
        メールアドレス（ログインID）
        <input name="email" type="email" required placeholder="you@example.com" className={input} />
      </label>
      <label className={label}>
        パスワード（8文字以上）
        <input name="password" type="password" required minLength={8} className={input} />
      </label>
      <label className={label}>
        パスワード（確認）
        <input name="password2" type="password" required minLength={8} className={input} />
      </label>
      <label className="flex items-start gap-2 text-[11px] text-neutral-300">
        <input name="agree" type="checkbox" required className="mt-0.5 accent-[#c9a227]" />
        <span>
          <a href="/pit/terms" target="_blank" rel="noopener" className="text-[#c9a227] underline">
            利用規約
          </a>
          に同意します
        </span>
      </label>
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-lg bg-[#c9a227] py-2.5 text-sm font-bold text-black disabled:opacity-50"
      >
        {busy ? "登録中…" : "登録する"}
      </button>
      {/* 同意の根拠となる文言（OAuth審査でも登録導線からの規約到達が見られる） */}
      <p className="pt-1 text-center text-[11px] leading-relaxed text-neutral-400">
        登録することで
        <a href="https://mbfasttuning.com/mbpit/terms/" target="_blank" rel="noopener" className="text-[#c9a227] underline">利用規約</a>
        と
        <a href="https://mbfasttuning.com/mbpit/privacy/" target="_blank" rel="noopener" className="text-[#c9a227] underline">プライバシーポリシー</a>
        に同意したものとみなします
      </p>
      {/* 既存ユーザーの逃げ道。登録導線に来てしまった加盟済みの店をここで拾う */}
      <p className="pt-1 text-center text-xs text-neutral-400">
        すでにアカウントをお持ちの方は{" "}
        <a href="/login" className="font-bold text-[#c9a227] underline">
          ログイン
        </a>
      </p>
    </form>
  );
}
