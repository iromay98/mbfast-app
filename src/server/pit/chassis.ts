/*
 * 車台番号・型式の文字列正規化（DBにも暗号にも依存しない純関数）。
 * 読み取り（shaken-ocr.ts）とHMAC生成（vehicle.ts）で同じ正規化を使うために分けている。
 * ここが揺れると同じ車が別の車として登録されるため、変更するときは既存データへの影響を確認する。
 */

/** 全角→半角・大文字化・記号除去（読取り揺れの正規化） */
export function normalizeChassis(raw: string): string {
  return (raw ?? "")
    .replace(/[Ａ-Ｚａ-ｚ０-９－]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "");
}
