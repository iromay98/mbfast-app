/*
 * 車検証（自動車検査証）の読み取り。証明書・法定記録簿の入力補助が目的。
 *
 * 設計方針（Step B）:
 *  - 主導線は写真の読み取り、フォールバックは手入力。読み取り結果は必ず編集可能にし、
 *    店舗が確定させるまで保存しない（誤った車台番号は証明書を無価値にする）
 *  - 推測・補完は禁止。読めない項目は空文字で返す（AIに埋めさせない）
 *  - 車検証画像はサーバーに保存しない。読み取り後にメモリから捨てる
 *    （画像には氏名・住所・車台番号が写るため、保存すると漏洩面が増えるだけ）
 *  - 読み取った値をログに出さない（氏名・住所・車台番号が含まれる）
 *  - 和暦→西暦の変換はここで行う（AIの計算に依存させない）
 */
import Anthropic from "@anthropic-ai/sdk";
import { normalizeChassis } from "@/server/pit/chassis";

// 読み取りは視覚的な帳票理解が要るためsonnetを既定に（PIT_OCR_MODEL で上書き可能）
const MODEL = process.env.PIT_OCR_MODEL ?? "claude-sonnet-5";

export function shakenOcrEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/** 車検証から取る項目（すべて文字列。空文字＝読み取れなかった） */
export type ShakenFields = {
  vin: string; // 車台番号
  registrationNumber: string; // 自動車登録番号／車両番号（例: 大阪 300 あ 12-34）
  makerName: string; // 車検証の「車名」欄（メーカー名が入る。例: トヨタ）
  modelCode: string; // 型式（例: 3BA-ZC33S）
  firstRegistered: string; // 初度登録年月（YYYY-MM）
  inspectionExpiry: string; // 有効期間の満了する日（YYYY-MM-DD）
  userName: string; // 使用者の氏名または名称
  userAddress: string; // 使用者の住所
};

export const EMPTY_SHAKEN_FIELDS: ShakenFields = {
  vin: "",
  registrationNumber: "",
  makerName: "",
  modelCode: "",
  firstRegistered: "",
  inspectionExpiry: "",
  userName: "",
  userAddress: "",
};

export type ShakenReadResult = {
  fields: ShakenFields;
  /** 店舗に確認してほしい点（値の疑わしさ・読めなかった項目） */
  warnings: string[];
  /** 0-1。低いときはUIで「手入力で確認してください」を強めに出す */
  confidence: number;
};

// ── 和暦 ──
// 車検証は和暦表記（令和6年5月20日）。西暦へ変換して扱う。
const ERAS: { names: string[]; base: number }[] = [
  { names: ["令和", "令", "R"], base: 2019 },
  { names: ["平成", "平", "H"], base: 1989 },
  { names: ["昭和", "昭", "S"], base: 1926 },
];

function eraBase(token: string): number | null {
  for (const e of ERAS) if (e.names.includes(token)) return e.base;
  return null;
}

/**
 * 日付文字列を YYYY-MM-DD（日が無ければ YYYY-MM）へ正規化する。
 * 受け付ける形: 2026-05-20 / 2026/5/20 / 20260520 / 令和8年5月20日 / R8.5.20 / 令和8年5月
 * 判定できないときは "" を返す（推測しない）。
 */
export function normalizeJpDate(raw: string, opts: { monthOnly?: boolean } = {}): string {
  const s = (raw ?? "")
    .replace(/[０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/元年/, "1年") // 令和元年 → 令和1年
    .replace(/\s|　/g, "")
    .trim();
  if (!s) return "";

  let y: number | null = null;
  let m: number | null = null;
  let d: number | null = null;

  const wareki = s.match(/^(令和|令|R|平成|平|H|昭和|昭|S)(\d{1,2})[年.\-/](\d{1,2})(?:[月.\-/](\d{1,2})日?)?/i);
  if (wareki) {
    // 1文字表記（R8.5.20 等）は大文字に揃える。漢字表記はそのまま引く
    const token = wareki[1].length === 1 ? wareki[1].toUpperCase() : wareki[1];
    const base = eraBase(token);
    if (base === null) return "";
    y = base + Number(wareki[2]) - 1;
    m = Number(wareki[3]);
    d = wareki[4] ? Number(wareki[4]) : null;
  } else {
    const seireki = s.match(/^(\d{4})[年.\-/]?(\d{1,2})(?:[月.\-/]?(\d{1,2})日?)?/);
    if (!seireki) return "";
    y = Number(seireki[1]);
    m = Number(seireki[2]);
    d = seireki[3] ? Number(seireki[3]) : null;
  }

  if (y === null || m === null || m < 1 || m > 12) return "";
  if (y < 1950 || y > 2100) return "";
  const ym = `${y}-${String(m).padStart(2, "0")}`;
  if (opts.monthOnly) return ym;
  if (d === null || d < 1 || d > 31) return ym;
  return `${ym}-${String(d).padStart(2, "0")}`;
}

/** 登録番号の正規化（全角→半角・区切りは半角スペース1つ。かな・漢字はそのまま） */
export function normalizeRegistrationNumber(raw: string): string {
  return (raw ?? "")
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[‐－ー―]/g, "-")
    .replace(/[\s　]+/g, " ")
    .trim();
}

/** 車台番号として妥当な形か（17桁VIN、または「英数-数字」の国内形式） */
export function looksLikeVin(vin: string): boolean {
  const v = normalizeChassis(vin);
  if (/^[A-HJ-NPR-Z0-9]{17}$/.test(v)) return true; // 輸入車のVIN（I/O/Qは使われない）
  return /^[A-Z0-9]{2,12}-\d{3,8}$/.test(v);
}

/**
 * 読み取り結果（AIの生出力・手入力のどちらでも）を正規化し、疑わしい点を洗い出す。
 * DB保存前に必ず通す。AI呼び出しを含まないので単体で検証できる。
 */
export function normalizeShakenFields(raw: Partial<Record<keyof ShakenFields, string>>): ShakenReadResult {
  const t = (v: string | undefined) => (v ?? "").replace(/[\s　]+/g, " ").trim();
  const fields: ShakenFields = {
    vin: normalizeChassis(t(raw.vin)),
    registrationNumber: normalizeRegistrationNumber(t(raw.registrationNumber)),
    makerName: t(raw.makerName),
    modelCode: normalizeChassis(t(raw.modelCode)),
    firstRegistered: normalizeJpDate(t(raw.firstRegistered), { monthOnly: true }),
    inspectionExpiry: normalizeJpDate(t(raw.inspectionExpiry)),
    userName: t(raw.userName),
    userAddress: t(raw.userAddress),
  };

  const warnings: string[] = [];
  if (!fields.vin) warnings.push("車台番号が読み取れませんでした。車検証を見て入力してください");
  else if (!looksLikeVin(fields.vin)) warnings.push(`車台番号の形が一般的ではありません（${fields.vin}）。誤読の可能性があります`);
  if (!fields.registrationNumber) warnings.push("登録番号が読み取れませんでした");
  if (!fields.modelCode) warnings.push("型式が読み取れませんでした");
  if (!fields.inspectionExpiry) warnings.push("有効期間の満了する日が読み取れませんでした");
  else if (fields.inspectionExpiry.length === 7) warnings.push("有効期間の満了する日は「日」まで入力してください");
  if (!fields.userName) warnings.push("使用者の氏名が読み取れませんでした（法定記録簿には必須です）");
  if (!fields.userAddress) warnings.push("使用者の住所が読み取れませんでした（法定記録簿には必須です）");

  // 8項目のうち埋まった数を素朴な自信度とする（形が怪しいものは0.5扱い）
  const filled = [
    fields.vin && looksLikeVin(fields.vin) ? 1 : fields.vin ? 0.5 : 0,
    fields.registrationNumber ? 1 : 0,
    fields.makerName ? 1 : 0,
    fields.modelCode ? 1 : 0,
    fields.firstRegistered ? 1 : 0,
    fields.inspectionExpiry.length === 10 ? 1 : fields.inspectionExpiry ? 0.5 : 0,
    fields.userName ? 1 : 0,
    fields.userAddress ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  return { fields, warnings, confidence: Math.round((filled / 8) * 100) / 100 };
}

const TOOL: Anthropic.Tool = {
  name: "report_shaken",
  description: "車検証から読み取った値を報告する。読み取れない項目は空文字にする。",
  input_schema: {
    type: "object",
    properties: {
      vin: { type: "string", description: "車台番号。ハイフンを含めて見えたとおり（例: ZC33S-123456）" },
      registrationNumber: { type: "string", description: "自動車登録番号または車両番号（例: 大阪 300 あ 12-34）" },
      makerName: { type: "string", description: "「車名」欄の値。メーカー名が入る（例: トヨタ）" },
      modelCode: { type: "string", description: "型式（例: 3BA-ZC33S）" },
      firstRegistered: { type: "string", description: "初度登録年月。見えたまま（例: 令和1年5月 / 2019-05）" },
      inspectionExpiry: { type: "string", description: "有効期間の満了する日。見えたまま（例: 令和8年5月20日）" },
      userName: { type: "string", description: "使用者の氏名または名称" },
      userAddress: { type: "string", description: "使用者の住所" },
      unreadable: { type: "boolean", description: "車検証として読めない画像（別の書類・ぼやけ等）なら true" },
    },
    required: [
      "vin",
      "registrationNumber",
      "makerName",
      "modelCode",
      "firstRegistered",
      "inspectionExpiry",
      "userName",
      "userAddress",
      "unreadable",
    ],
    additionalProperties: false,
  },
};

const SYSTEM = `あなたは日本の自動車検査証（車検証）を読み取る事務担当です。
画像に写っている文字を、書かれているとおりに転記します。

厳守事項:
- 推測・補完・訂正をしない。読めない文字がある項目は空文字にする（誤った車台番号は書類を無効にします）
- 「車名」欄はメーカー名（トヨタ・ニッサン等）。車種名を書かない
- 「型式」と「車台番号」を混同しない。型式は排ガス記号付き（例 3BA-ZC33S）、車台番号は「型式-連番」または17桁
- 日付は和暦のまま転記する（西暦へ変換しない。変換はシステム側で行う）
- 使用者と所有者が別に書かれている場合は「使用者」の欄を採用する
- 電子車検証（A6サイズ・記載が省略されたもの）では読み取れない項目が多い。無理に埋めない`;

/**
 * 車検証画像を読み取る。画像は保存しない（呼び出し側もメモリで捨てる）。
 * 失敗時は error を返し、UIは手入力へフォールバックする。
 */
export async function readShakenImage(
  image: Buffer,
  mediaType: "image/jpeg" | "image/png" | "image/webp",
): Promise<{ result?: ShakenReadResult; error?: string }> {
  if (!shakenOcrEnabled()) return { error: "読み取り機能が未設定です（本部にお問い合わせください）" };
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let msg: Anthropic.Message;
  try {
    msg = await client.messages.create({
      model: MODEL,
      max_tokens: 900,
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: "tool", name: "report_shaken" },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: image.toString("base64") } },
            { type: "text", text: "この車検証を report_shaken で報告してください。" },
          ],
        },
      ],
    });
  } catch (e) {
    // 例外メッセージに読み取り値は含まれないが、念のため要約だけ残す
    console.error("mbPIT: 車検証の読み取りに失敗", e instanceof Error ? e.message : "unknown");
    return { error: "読み取りに失敗しました。もう一度撮影するか、手入力で進めてください" };
  }
  const block = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!block) return { error: "読み取り結果を受け取れませんでした。手入力で進めてください" };
  const input = block.input as Partial<Record<keyof ShakenFields, string>> & { unreadable?: boolean };
  if (input.unreadable) {
    return { error: "車検証として読み取れませんでした。明るい場所で全体が入るように撮影してください" };
  }
  return { result: normalizeShakenFields(input) };
}
