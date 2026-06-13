// 画面遷移中のローディング表示（共有）。クリック直後に即フィードバックを出し、
// 「押したのに無反応＝固まった」という体感を防ぐ。
export function PageLoading() {
  return (
    <div className="flex items-center justify-center py-24" role="status" aria-label="読み込み中">
      <span className="h-7 w-7 animate-spin rounded-full border-2 border-gold-300 border-t-gold-600" />
    </div>
  );
}
