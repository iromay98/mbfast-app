/*
 * Googleマップ投稿の本文（純関数・外部依存なし）。
 *
 * 投稿処理(src/server/pit/gbp/auto-post.ts)から切り離してあるのは、
 * DBやGoogleに繋がずに文面だけを検査・プレビューできるようにするため。
 *   npm run check:map-post
 *
 * GBPの投稿は作成後に編集できない。出す前に中身を確かめられることが重要。
 */

/** Googleマップ投稿の本文。一覧では先頭80〜100字ほどしか読まれないので、車種と作業内容を先頭に置く */
export function buildMapPostText(opts: {
  vehicle: string;
  title: string;
  memo?: string | null;
}): string {
  const lines: string[] = [];
  // タイトルは「【施工記録】車種 作業内容｜…」形式。装飾と店名を落として読みやすくする
  const head = opts.title
    .replace(/^【[^】]*】/, "")
    .split("｜")[0]
    .trim();
  lines.push(head || `${opts.vehicle} 施工記録`);

  const memo = (opts.memo ?? "").trim();
  if (memo) {
    lines.push("");
    // 長いメモは切る。GBPの一覧は先頭しか出ないので、続きは記事側で読んでもらう
    lines.push(memo.length > 600 ? `${memo.slice(0, 600)}…` : memo);
  }
  lines.push("");
  lines.push("施工の詳細は記録ページでご覧いただけます。");
  return lines.join("\n");
}
