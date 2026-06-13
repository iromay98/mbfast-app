"use client";

// ルートレイアウト自体の描画が失敗した時の最終防衛線。
// これ自身が <html>/<body> を持つ必要がある（root layout を置き換えるため）。
// Tailwind が効かない可能性があるのでインラインスタイルで最小構成にする。
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="ja">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "system-ui, sans-serif",
          background: "#faf9f7",
          color: "#1c1917",
        }}
      >
        <div style={{ maxWidth: 420, padding: 24, textAlign: "center" }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>
            問題が発生しました
          </h2>
          <p style={{ fontSize: 14, color: "#57534e", marginBottom: 20 }}>
            画面の読み込み中にエラーが起きました。下のボタンで復帰できます。
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
            <button
              type="button"
              onClick={() => reset()}
              style={{
                background: "#d4a017",
                color: "#fff",
                border: "none",
                borderRadius: 8,
                padding: "8px 16px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              再試行
            </button>
            <button
              type="button"
              onClick={() => window.location.reload()}
              style={{
                background: "#fff",
                color: "#57534e",
                border: "1px solid #e7e5e4",
                borderRadius: 8,
                padding: "8px 16px",
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              再読み込み
            </button>
          </div>
          {error.digest && (
            <p style={{ marginTop: 16, fontSize: 12, color: "#a8a29e" }}>
              参照ID: {error.digest}
            </p>
          )}
        </div>
      </body>
    </html>
  );
}
