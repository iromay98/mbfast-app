// mbPIT コンテンツガード。
// ①排ガス規制デバイス無効化系 → 公開ブロック(held) ②車検非対応になりうる内容 → 注意書き自動挿入
// ③個人情報（電話番号・メール等）→ 記事素材から除去
// 判定対象は memo / vehicle のテキストのみ（既存方針: この領域の宣伝コンテンツは自動生成しない）。

export type GuardResult = {
  blocked: boolean; // true = held（自動公開しない）
  blockReasons: string[];
  cautionNeeded: boolean; // 記事末尾に定型注意文言を挿入
  cautionReasons: string[];
  cleanedMemo: string; // 個人情報を除去したmemo
  notes: string[]; // ログ用（何を除去したか等）
};

// 公開ブロック: 排ガス規制デバイスの無効化に該当する語
const BLOCK_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /(scr|アドブルー|adblue|ad\s*blue)[^。\n]{0,12}(削除|カット|キャンセル|無効|レス|off)/i, label: "SCR/AdBlue無効化" },
  { re: /(dpf|ディーゼル.?パティキュレート)[^。\n]{0,12}(削除|カット|キャンセル|無効|レス|off)/i, label: "DPF無効化" },
  { re: /dpfレス|アドブルーカット|アドブルー削除/i, label: "排ガスデバイス無効化" },
  { re: /egr[^。\n]{0,12}(削除|カット|キャンセル|無効|レス|off)/i, label: "EGR無効化" },
  { re: /(nox|o2|オーツー|ラムダ)[^。\n]{0,10}(センサー)?[^。\n]{0,8}(削除|カット|キャンセル|無効)/i, label: "NOx/O2センサー無効化" },
  { re: /(触媒|キャタ(ライザー)?|catalyst)[^。\n]{0,10}(削除|レス|ストレート)/i, label: "触媒除去" },
];

// 注意書き挿入: 車検非対応になりうる内容
const CAUTION_PATTERNS: { re: RegExp; label: string }[] = [
  { re: /アフター(ファイヤ|ファイア)|バブリング|ポップ|pops|バーブル|音量|爆音|マフラー音/i, label: "音量系" },
  { re: /触媒レス前提|ストレートパイプ|直管/i, label: "触媒レス関連" },
  { re: /車検非対応|競技専用|レース専用|サーキット専用/i, label: "競技用途" },
];

export const CAUTION_HTML =
  '<p><small>※車検対応可否は車両状態・地域により異なります。公道使用に関わる詳細はお問い合わせください。</small></p>';

// 電話番号らしき文字列（日本の形式）とメールアドレス
const PHONE_RE = /(?:0\d{1,4}[-\s()]?\d{1,4}[-\s()]?\d{3,4})/g;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.]+/g;

export function runGuard(vehicle: string, memo: string | null | undefined): GuardResult {
  const text = `${vehicle}\n${memo ?? ""}`;
  const blockReasons = BLOCK_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.label);
  const cautionReasons = CAUTION_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.label);

  const notes: string[] = [];
  let cleanedMemo = memo ?? "";
  if (PHONE_RE.test(cleanedMemo)) {
    cleanedMemo = cleanedMemo.replace(PHONE_RE, "");
    notes.push("電話番号らしき文字列を除去");
  }
  if (EMAIL_RE.test(cleanedMemo)) {
    cleanedMemo = cleanedMemo.replace(EMAIL_RE, "");
    notes.push("メールアドレスを除去");
  }

  return {
    blocked: blockReasons.length > 0,
    blockReasons,
    cautionNeeded: cautionReasons.length > 0,
    cautionReasons,
    cleanedMemo: cleanedMemo.trim(),
    notes,
  };
}
