/*
 * SW 表示ラベル。ハッシュ(内容)が同じファイルは同一とみなすが、
 * 同じ SW なのに内容(hash)が異なる別ファイルは通し番号で区別する。
 *   seq 0 → "89663-24690"（無印）
 *   seq 1 → "89663-24690-A"
 *   seq 2 → "89663-24690-B" …（26超は -AA, -AB …）
 */

export function swSeqSuffix(seq: number | null | undefined): string {
  let n = seq ?? 0;
  if (n < 1) return "";
  let out = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    out = String.fromCharCode(65 + r) + out;
    n = Math.floor((n - 1) / 26);
  }
  return "-" + out;
}

export function swLabel(sw: string | null | undefined, seq: number | null | undefined): string {
  if (!sw) return "";
  return sw + swSeqSuffix(seq);
}
