// 復号後binから「識別子っぽい印字可能文字列」を抽出して候補リストにする。
// AI に bin 全体は送らず、この候補だけを渡す（安く・速く・確実）。
// ノイズ（マップ/データ由来の偶然のASCII）を落とし、部番らしさでスコアリングして上位を返す。

// バイナリ→印字可能ASCII（非印字は空白に）。
function ascii(buf: Buffer): string {
  return buf.toString("latin1").replace(/[^\x20-\x7E]/g, " ");
}

// 英数で始まり、英数・_-./ を含む 5〜24文字。
const TOKEN = /[A-Za-z0-9][A-Za-z0-9_./-]{4,23}/g;

const VAG_PART = /^\d[A-Z0-9]{2}\d{6}[A-Z]{0,2}$/; // 07K907309C, 8V0907404
const MB_PART = /^A?\d{9,11}$/; // 2769033704, A2769003200（メルセデス部番）
const CALish = /^[A-Z0-9]{4,}[_ ]?\d{3,4}$/; // SW + バージョン

function distinct(s: string): number {
  return new Set(s).size;
}
function maxRun(s: string): number {
  let best = 1,
    cur = 1;
  for (let i = 1; i < s.length; i++) {
    cur = s[i] === s[i - 1] ? cur + 1 : 1;
    if (cur > best) best = cur;
  }
  return best;
}
function counts(s: string) {
  let lower = 0,
    upperDigit = 0;
  for (const c of s) {
    if (c >= "a" && c <= "z") lower++;
    else if ((c >= "A" && c <= "Z") || (c >= "0" && c <= "9")) upperDigit++;
  }
  return { lower, upperDigit };
}

// 部番らしさのスコア。> 0 のものだけ採用。
function score(t: string): number {
  if (!/\d/.test(t)) return -1; // 数字を含まない＝英単語等
  if (distinct(t) < 4) return -1; // 33333333, 255665 等の低情報
  if (maxRun(t) >= 4) return -1; // 同一文字の連続は data 由来
  const { lower, upperDigit } = counts(t);
  if (lower > upperDigit) return -1; // 小文字優位＝ランダムノイズ寄り
  let s = 0;
  if (VAG_PART.test(t)) s += 4;
  if (MB_PART.test(t)) s += 3;
  if (CALish.test(t)) s += 2;
  if (/^[A-Z0-9_]+$/.test(t)) s += 1; // 大文字+数字+_
  if (t.length >= 8 && t.length <= 16) s += 1;
  if (/[A-Z]/.test(t) && /\d/.test(t)) s += 1; // 英字と数字の混在
  return s;
}

export function extractIdCandidates(buf: Buffer, limit = 250): string[] {
  const text = ascii(buf);
  const best = new Map<string, number>();
  for (const m of text.matchAll(TOKEN)) {
    const t = m[0];
    if (best.has(t)) continue;
    const s = score(t);
    if (s > 0) best.set(t, s);
  }
  return [...best.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([t]) => t);
}

