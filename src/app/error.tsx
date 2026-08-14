"use client";

import { useEffect, useState } from "react";

/*
 * ルートのエラーバウンダリ。サーバ/クライアントの描画エラーで画面が固まった時、
 * リロードせずに「再試行」で復帰できるようにする（戻らずリロード必要、の対策）。
 *
 * よくある原因が「デプロイ直後に古い画面のまま操作した」ケース。
 * Next.jsのサーバーアクションは配信ごとにIDが変わるため、開いたままの画面から
 * 送信すると "Failed to find Server Action ..." になる（アプリ更新のたびに起きる）。
 * 中身は正常なので、この場合だけは黙って1回だけ自動リロードして復帰させる
 * （＝現場が「エラーで再読み込みしろと出る」で止まらないようにする）。
 * 無限リロードを避けるため sessionStorage で1回だけに制限する。
 */

const RELOAD_ONCE_KEY = "mbfast:auto-reloaded-at";
const RELOAD_COOLDOWN_MS = 60_000;

/** デプロイ入れ替わりが原因のエラーか（アプリの不具合ではない） */
function isStaleDeploymentError(error: Error & { digest?: string }): boolean {
  const msg = `${error.message ?? ""} ${error.digest ?? ""}`;
  return (
    /Failed to find Server Action/i.test(msg) ||
    /older or newer deployment/i.test(msg) ||
    // チャンク読み込み失敗も同じ原因（古いページが消えたJSを取りに行く）
    /ChunkLoadError|Loading chunk .* failed|Failed to fetch dynamically imported module/i.test(msg)
  );
}

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [stale, setStale] = useState(false);

  useEffect(() => {
    // 監査用にコンソールへ
    console.error("[route error]", error);

    if (!isStaleDeploymentError(error)) return;
    setStale(true);
    // 直近に自動リロードしていなければ1回だけ自動で入れ替える
    const last = Number(sessionStorage.getItem(RELOAD_ONCE_KEY) ?? 0);
    if (Date.now() - last > RELOAD_COOLDOWN_MS) {
      sessionStorage.setItem(RELOAD_ONCE_KEY, String(Date.now()));
      window.location.reload();
    }
  }, [error]);

  return (
    <div className="mx-auto max-w-md px-6 py-16 text-center">
      <h2 className="mb-2 text-lg font-bold text-ink">
        {stale ? "アプリが更新されました" : "問題が発生しました"}
      </h2>
      <p className="mb-5 text-sm text-ink-soft">
        {stale ? (
          <>
            新しいバージョンに入れ替わったため、開いていた画面のままでは操作できませんでした。
            自動で読み込み直しています（切り替わらない場合は下のボタンを押してください）。
            <br />
            <b>送信した内容は保存されていません</b>ので、読み込み後にもう一度お試しください。
          </>
        ) : (
          <>画面の読み込み中にエラーが起きました。下の「再試行」で復帰できます（多くの場合リロード不要です）。</>
        )}
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {!stale && (
          <button
            type="button"
            onClick={() => reset()}
            className="rounded-lg bg-gold-500 px-4 py-2 text-sm font-semibold text-white"
          >
            再試行
          </button>
        )}
        <button
          type="button"
          onClick={() => window.location.reload()}
          className={`rounded-lg px-4 py-2 text-sm font-semibold ${
            stale
              ? "bg-gold-500 text-white"
              : "border border-line text-ink-soft hover:bg-surface-2"
          }`}
        >
          再読み込み
        </button>
      </div>
      {error.digest && (
        <p className="mt-4 font-mono text-xs text-ink-soft">参照ID: {error.digest}</p>
      )}
    </div>
  );
}
