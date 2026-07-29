/*
 * バリエーションの「構成」の同定ルール（DB非依存・純関数）。
 *
 * なぜ切り出すか:
 *   同じ構成(ステージ・バブリング・OP集合)の TunedVariant は複数行に増えてしまうことがあり、
 *   「差し替え」「表示」「代理店への配信」がそれぞれ別の行を選んでしまうと
 *   「差し替えたのに差し替わらない」が起きる。選び方をここ1箇所に固定する。
 */

export type VariantConfigRow = {
  id: string;
  status: "DRAFT" | "AVAILABLE" | "DISABLED";
  optionTags: string[];
  fileRef?: string | null;
  createdAt?: Date | null;
};

// 同じ要素集合か（順不同・重複は無視しない＝件数も一致すること）
export function sameTagSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((x, i) => x === sb[i]);
}

// 構成キー（重複排除・ソートしてから比較する正規形）。
export function tagSetKey(tags: string[]): string {
  return [...new Set(tags)].sort().join("");
}

/*
 * 選択タグの正規化。許可リスト外のタグは「落とす」のではなく dropped として返す。
 * 落としたまま構成を同定すると、別構成の既存バリエーションを取り違えて上書きしてしまう
 * （例: 燃料をガソリンに直した後、EGR付きの行を差し替えるとEGR無しの行が書き換わる）。
 */
export function normalizeSelectedTags(
  tags: string[],
  opts: { allowed: string[]; pops: boolean; popsStrongTag: string },
): { tags: string[]; dropped: string[] } {
  const allow = new Set(opts.allowed);
  const uniq = [...new Set(tags.map((t) => String(t)))];
  // バブリング強はバブリング選択時のみ有効（意図的な正規化なので dropped には数えない）
  const meaningful = opts.pops ? uniq : uniq.filter((t) => t !== opts.popsStrongTag);
  const kept = meaningful.filter((t) => allow.has(t));
  const dropped = meaningful.filter((t) => !allow.has(t));
  return { tags: kept.sort(), dropped };
}

/*
 * 同構成の候補から差し替え先を1つ決める。順序は必ず決定的にする
 * （findMany は orderBy が無いと順序が保証されず、更新のたびに入れ替わる）。
 * 優先: 配布可 → 実体あり → 作成が古い → id。
 */
export function pickReplaceTarget<T extends VariantConfigRow>(rows: T[]): T | null {
  if (rows.length === 0) return null;
  const score = (r: T) => (r.status === "AVAILABLE" ? 2 : 0) + (r.fileRef ? 1 : 0);
  return [...rows].sort(
    (a, b) =>
      score(b) - score(a) ||
      (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0) ||
      a.id.localeCompare(b.id),
  )[0];
}

/*
 * 差し替え先以外に「配布可」で残っている同構成の重複行。
 * 代理店の解決(resolveTuning)はこの中のどれを引くか保証できないため、同じファイルに揃える。
 */
export function staleDuplicateIds<T extends VariantConfigRow>(rows: T[], targetId: string): string[] {
  return rows.filter((r) => r.id !== targetId && r.status === "AVAILABLE").map((r) => r.id);
}

// .slave 再暗号化キャッシュのキー。fileHash が無い（古いデータ）ときに
// "nohash" で共有すると別ファイルのキャッシュを掴むので、fileRef で必ず一意にする。
export function encryptedCacheKey(
  file: { fileHash?: string | null; fileRef: string },
  slaveId: string,
): string {
  const id = file.fileHash?.trim() || `ref-${file.fileRef.replace(/[^A-Za-z0-9_.-]/g, "_")}`;
  return `catalog/encrypted/${id}__${slaveId}.slave`;
}
