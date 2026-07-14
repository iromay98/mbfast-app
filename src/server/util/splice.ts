// 別ツール準用のための「ニコイチ」エンジン（キャリブレーション転写）。
//
// 目的: catalog の (ori_cat, tuned_cat)[同一レイアウト] の差分＝キャリブレーション変更を、
// 代理店が別ツールで読んだ ori_dealer[別レイアウト] の該当箇所だけに転写する。
// その他の領域は代理店oriのまま（＝ニコイチ）。
//
// 安全方針:
//  - 差分は ori_cat と tuned_cat（同一サイズ）から自動検出。
//  - 転写先は「変更箇所の直前後の不変バイト（アンカー）」を ori_dealer 内で一意探索して特定。
//    一意に見つからない/レイアウトが噛み合わない場合は転写せずエラー（危険な当て込みをしない）。
//  - チェックサムの自動補正はしない（別途・人間が検証）。あくまで候補生成。

export type SpliceRange = {
  catStart: number;
  catEnd: number; // exclusive
  dealerStart: number;
  len: number;
};

export type SpliceResult =
  | {
      ok: true;
      output: Buffer;
      ranges: SpliceRange[];
      changedBytes: number;
      sameLayout: boolean;
      note: string;
    }
  | { ok: false; error: string };

const ANCHOR = 32; // アンカー（前後の不変バイト）の長さ
const MERGE_GAP = 16; // これ以下の間隔の変更は1つの範囲に併合

// ori_cat と tuned_cat（同一サイズ）の変更範囲を検出（近接は併合）。
function diffRanges(a: Buffer, b: Buffer): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  let i = 0;
  const n = a.length;
  while (i < n) {
    if (a[i] !== b[i]) {
      let j = i + 1;
      let gap = 0;
      let end = j;
      // 連続 or MERGE_GAP 以内の再変更まで1範囲に
      while (j < n && gap <= MERGE_GAP) {
        if (a[j] !== b[j]) {
          end = j + 1;
          gap = 0;
        } else {
          gap++;
        }
        j++;
      }
      ranges.push({ start: i, end });
      i = end;
    } else {
      i++;
    }
  }
  return ranges;
}

// buf 内で needle が最初に現れる位置（無ければ -1）。2回目以降の存在も確認するため count も返す。
function findUnique(buf: Buffer, needle: Buffer): { pos: number; count: number } {
  let pos = buf.indexOf(needle);
  const first = pos;
  let count = 0;
  while (pos !== -1) {
    count++;
    if (count > 1) break; // 一意性判定には2件見つかれば十分
    pos = buf.indexOf(needle, pos + 1);
  }
  return { pos: first, count };
}

export function computeSplice(
  oriCat: Buffer,
  tunedCat: Buffer,
  oriDealer: Buffer,
): SpliceResult {
  if (oriCat.length !== tunedCat.length) {
    return {
      ok: false,
      error: "catalogの純正(ori)とチューン済み(tuned)のサイズが異なります（同一レイアウトが必要）",
    };
  }
  const rawRanges = diffRanges(oriCat, tunedCat);
  if (rawRanges.length === 0) {
    return { ok: false, error: "純正とチューン済みに差分がありません（キャリブレーション変更なし）" };
  }
  const changedBytes = rawRanges.reduce((n, r) => n + (r.end - r.start), 0);
  const sameLayout = oriCat.length === oriDealer.length;

  const out = Buffer.from(oriDealer); // 代理店oriをベースにする
  const ranges: SpliceRange[] = [];

  for (const r of rawRanges) {
    const len = r.end - r.start;
    let dealerStart: number;

    if (sameLayout) {
      // 同一サイズ＝同一レイアウトとみなし、同オフセットへ。
      // 念のため、変更範囲の直前アンカーが一致することを確認（違えば拒否）。
      dealerStart = r.start;
      const aStart = Math.max(0, r.start - ANCHOR);
      if (
        aStart < r.start &&
        !oriCat.subarray(aStart, r.start).equals(oriDealer.subarray(aStart, r.start))
      ) {
        return {
          ok: false,
          error: `同一サイズですがオフセット${r.start}付近のレイアウトが一致しません（準用不可）`,
        };
      }
    } else {
      // 別レイアウト: 変更範囲の直前の不変バイト(アンカー)を ori_dealer 内で一意探索。
      const aStart = r.start - ANCHOR;
      if (aStart < 0) {
        return { ok: false, error: `変更範囲(${r.start})が先頭に近すぎてアンカーを取れません` };
      }
      const anchorBefore = oriCat.subarray(aStart, r.start);
      const { pos, count } = findUnique(oriDealer, anchorBefore);
      if (pos === -1) {
        return {
          ok: false,
          error: `キャリブレーションエリア(cat:${r.start})を代理店oriで特定できません（レイアウトが大きく異なる）`,
        };
      }
      if (count > 1) {
        return {
          ok: false,
          error: `キャリブレーションエリア(cat:${r.start})のアンカーが代理店ori内で一意でないため準用できません`,
        };
      }
      dealerStart = pos + ANCHOR;
      // 直後のアンカーも一致するか確認（範囲長・レイアウト整合の検証）
      const afterCat = oriCat.subarray(r.end, r.end + ANCHOR);
      const afterDealer = oriDealer.subarray(dealerStart + len, dealerStart + len + ANCHOR);
      if (afterCat.length > 0 && !afterCat.equals(afterDealer)) {
        return {
          ok: false,
          error: `キャリブレーションエリア(cat:${r.start})の後端が代理店oriと噛み合いません（準用不可）`,
        };
      }
    }

    if (dealerStart + len > out.length) {
      return { ok: false, error: `転写先が代理店oriの範囲外です（cat:${r.start}）` };
    }
    // tuned_cat のキャリブレーション値を代理店oriの該当箇所へ転写
    tunedCat.copy(out, dealerStart, r.start, r.end);
    ranges.push({ catStart: r.start, catEnd: r.end, dealerStart, len });
  }

  const note = sameLayout
    ? "同一サイズ・同一オフセットで転写"
    : "別レイアウト・アンカー探索で転写";
  return { ok: true, output: out, ranges, changedBytes, sameLayout, note };
}
