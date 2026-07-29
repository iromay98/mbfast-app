/*
 * 表現の禁止事項チェック（景品表示法・保険/法適合の断定回避）。
 *
 * 「保険が下りる」「車検に通る」「査定額が上がる」等の約束・保証表現をUI文言とAI生成文の
 * 両方で出さないための検査。定義はこのファイルに集約し、生成処理・画面文言テストから参照する。
 * 事実の記述（「記録として保存します」「説明資料として利用できます」）は許容。
 */

export type CopyViolation = { pattern: string; reason: string };

/**
 * 検査の強度。
 *  generated = AI生成文・アプリのUI文言 → 違反はブロック（公開させない）
 *  user      = 店舗が書いた自由文       → 警告のみ（現場の入力を弾くと使われなくなる）
 */
export type CopyMode = "generated" | "user";

const RULES: { re: RegExp; label: string; reason: string }[] = [
  // 保険金の支払いを約束・示唆する表現
  { re: /保険(金)?が(下り|おり|支払われ)/, label: "保険金の支払いを示唆", reason: "支払いは保険会社の判断であり約束できない" },
  { re: /保険.{0,6}(必ず|確実に|100%)/, label: "保険の確約", reason: "支払いを保証する表現" },
  { re: /全額(補償|保証)/, label: "全額補償の断定", reason: "補償範囲を保証できない" },
  // 法適合の保証
  { re: /車検に(通り|通る|通ります|パス)/, label: "車検適合の保証", reason: "検査結果を保証できない" },
  { re: /(完全に|必ず)?合法(です|になります)/, label: "合法性の断定", reason: "法適合を保証する表現" },
  { re: /保安基準.{0,4}(適合を保証|問題ありません)/, label: "保安基準適合の保証", reason: "適合を保証できない" },
  // 金銭的効果の断定
  { re: /査定(額)?が(上が|アップ)/, label: "査定額上昇の断定", reason: "査定は買取店の判断" },
  { re: /(高く売れ|高値で売却できま)/, label: "売却価格の断定", reason: "価格を保証できない" },
  { re: /リセールバリュー.{0,6}(上が|向上します)/, label: "リセール向上の断定", reason: "価格を保証できない" },
];

/** 違反表現を返す（空配列＝問題なし）。判定自体は強度に依らず共通 */
export function checkCopy(text: string): CopyViolation[] {
  const t = text.replace(/\s+/g, "");
  const out: CopyViolation[] = [];
  for (const r of RULES) {
    if (r.re.test(t)) out.push({ pattern: r.label, reason: r.reason });
  }
  return out;
}

/** 生成文・UI文言に禁止表現があれば公開を止める（ブロック） */
export function assertCopyOk(text: string, where = "生成文"): void {
  const v = checkCopy(text);
  if (v.length > 0) {
    throw new Error(
      `${where}に使用できない表現が含まれています: ${v.map((x) => x.pattern).join("・")}`,
    );
  }
}

/**
 * 強度つきの検査結果。店舗の自由文（作業メモ・追記）は警告に留め、
 * 画面に注意を出すだけで保存・投稿は止めない。
 */
export function reviewCopy(
  text: string,
  mode: CopyMode,
): { severity: "ok" | "warn" | "block"; violations: CopyViolation[]; message: string } {
  const violations = checkCopy(text);
  if (violations.length === 0) return { severity: "ok", violations, message: "" };
  const names = violations.map((v) => v.pattern).join("・");
  return mode === "generated"
    ? { severity: "block", violations, message: `使用できない表現が含まれています: ${names}` }
    : {
        severity: "warn",
        violations,
        message: `${names} は断定的な表現です。事実の記述に言い換えることをおすすめします（このまま保存もできます）`,
      };
}

/** 画面に出して良い言い換えの例（UI文言のレビュー用・実装から参照して統一する） */
export const SAFE_PHRASES = {
  insurance: "施工内容と金額を記録として保存し、保険会社への説明資料として利用できます",
  legal: "特定整備記録簿に必要な項目を記録します（法令の要件は事業場でご確認ください）",
  resale: "施工履歴を第三者に提示できる形で残せます",
} as const;
