// mbPIT コンテンツガード。
// memo / vehicle のテキストを判定し、
//  ① 公開ブロック: 排ガス規制デバイス無効化（SCR/AdBlue・DPF・EGR の削除/キャンセル等）
//     → 記事を生成せず HELD で保存し本部へ通知（既存方針: この領域の宣伝は自動生成対象外）
//  ② 注意書き挿入: 車検非対応になりうる施工（アフターファイヤー音量系・触媒レス前提等）
//     → 記事末尾に定型注意文言を自動挿入
//  ③ PII: 電話番号らしき文字列を memo から除去（個人名は AI プロンプト側でも排除を指示）

export type GuardResult = {
  blocked: string[]; // ①に該当した語（空なら公開可）
  caution: string[]; // ②に該当した語
  piiRemoved: boolean;
  sanitizedMemo: string; // 電話番号除去後の memo（AI へはこちらを渡す）
};

// デバイス名と無効化動詞が近接して出現したらブロック。
// 「DPFレス」「アドブルーキャンセル」等の連結表現も同じ正規表現で拾う。
const BLOCK_PATTERNS: RegExp[] = [
  /(?:SCR|アドブルー|adblue|尿素(?:水|システム)?)[^。\n]{0,10}?(?:削除|レス|キャンセル|解除|無効|カット|停止|デリート|delete|off)/i,
  /(?:DPF|パティキュレート\S*)[^。\n]{0,10}?(?:削除|レス|キャンセル|解除|無効|カット|除去|デリート|delete|off)/i,
  /EGR[^。\n]{0,10}?(?:削除|レス|キャンセル|解除|無効|カット|除去|デリート|delete|off)/i,
  /(?:O2|オーツー|ラムダ)センサー?[^。\n]{0,10}?(?:キャンセル|削除|無効|デリート)/i,
];

// 車検非対応になりうる施工（注意書き対象）
const CAUTION_PATTERNS: RegExp[] = [
  /アフターファイ(?:ヤ|ア)ー?/,
  /バブリング/,
  /pops?\s*(?:&|and)?\s*bangs?/i,
  /触媒(?:レス|ストレート|無し|なし|外し)/,
  /キャタ(?:レス|ライザーレス)/,
  /直管/,
  /マフラー[^。\n]{0,6}(?:音量|爆音)/,
];

// 記事末尾に挿入する定型注意文言（Gutenberg 段落ブロック）
export const CAUTION_NOTICE_HTML =
  '<!-- wp:paragraph {"fontSize":"small"} --><p class="has-small-font-size">※本施工は車両の状態・仕様により車検対応可否が異なる場合があります。詳細は店舗までお問い合わせください。</p><!-- /wp:paragraph -->';

// 電話番号らしき文字列（固定・携帯・ハイフン/空白区切り）。誤爆を避けるため 10 桁以上相当のみ。
const PHONE_RE = /(?:\+81[-\s]?)?0\d{1,4}[-()\s]?\d{2,4}[-()\s]?\d{3,4}/g;

function findMatches(text: string, patterns: RegExp[]): string[] {
  const hits: string[] = [];
  for (const re of patterns) {
    const m = text.match(re);
    if (m && m[0]) hits.push(m[0]);
  }
  return hits;
}

export function runContentGuard(vehicle: string, memo: string | null | undefined): GuardResult {
  const memoText = memo ?? "";
  const combined = `${vehicle}\n${memoText}`;

  const blocked = findMatches(combined, BLOCK_PATTERNS);
  const caution = findMatches(combined, CAUTION_PATTERNS);

  // /g 付き RegExp の .test() は lastIndex が残り不安定なため match で判定する
  let sanitizedMemo = memoText;
  let piiRemoved = false;
  if (memoText.match(PHONE_RE)) {
    sanitizedMemo = memoText.replace(PHONE_RE, "");
    piiRemoved = true;
  }

  return { blocked, caution, piiRemoved, sanitizedMemo };
}
