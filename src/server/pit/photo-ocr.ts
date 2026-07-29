/*
 * 施工写真からの値の読み取り（証明書の入力補助）。
 *
 * なぜ写真からにするか: DOT（タイヤ製造週）とロット番号は手入力だと確実に記入漏れる。
 * 写真を撮れば入る導線を主にして、記録の欠けを構造的に減らす。
 *
 * 守っていること（車検証の読み取りと同じ）:
 *  - 推測・補完はさせない。読めない項目は空で返す（誤ったロット番号は記録として無価値）
 *  - 読み取り結果は必ず店舗が確認・修正してから保存する（このモジュールは保存しない）
 *  - 写真はメモリ上でのみ扱い保存しない。読み取った値もログに出さない
 *    （証跡としての写真保存は別途。今は入力補助のみ）
 *  - 正規化・妥当性判定は純関数に分け、AIの出力を検証してから返す
 */
import Anthropic from "@anthropic-ai/sdk";

const MODEL = process.env.PIT_OCR_MODEL ?? "claude-sonnet-5";

export function photoOcrEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

/** 読み取り対象（撮るものごとに聞く項目が違う） */
export type OcrTarget = "product_label" | "tire" | "meter" | "device_screen";

export const OCR_TARGETS: { key: OcrTarget; label: string; hint: string; fields: string[] }[] = [
  {
    key: "product_label",
    label: "製品ラベル",
    hint: "製品名・メーカー・ロット番号が写るように撮ってください",
    fields: ["product_name", "maker", "lot_no"],
  },
  {
    key: "tire",
    label: "タイヤ側面",
    hint: "銘柄・サイズ・DOT（4桁の刻印）が写るように撮ってください",
    fields: ["brand", "size", "dot"],
  },
  { key: "meter", label: "メーター", hint: "走行距離の数字がはっきり写るように撮ってください", fields: ["odometer_km"] },
  {
    key: "device_screen",
    label: "測定器の画面",
    hint: "測定値が読める状態で撮ってください",
    fields: ["soh", "measured_label", "measured_value"],
  },
];

export type OcrValues = Record<string, string>;

export type PhotoOcrResult = {
  target: OcrTarget;
  values: OcrValues;
  /** 補足表示（DOTの年週など、人が確認しやすい形） */
  notes: string[];
  warnings: string[];
};

// ── 正規化・妥当性（純関数。AI呼び出しを含まないので単体で検証できる） ──

function toHalfWidth(s: string): string {
  return (s ?? "")
    .replace(/[Ａ-Ｚａ-ｚ０-９／]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/[‐－ー―]/g, "-")
    .trim();
}

/**
 * DOTの製造週（4桁: 週2桁＋年下2桁）。
 * 「3223」= 2023年32週。週は01〜53のみ有効。判定できなければ空を返す。
 */
export function normalizeDot(raw: string): string {
  const digits = toHalfWidth(raw).replace(/\D/g, "");
  // 刻印全体（DOT U2LL LMLR 3223 等）が来ても末尾4桁を採用する
  const four = digits.length >= 4 ? digits.slice(-4) : "";
  if (four.length !== 4) return "";
  const week = Number(four.slice(0, 2));
  if (week < 1 || week > 53) return "";
  return four;
}

/** DOTを人が確認できる表示にする（2023年32週）。西暦は現在年を超えないように補う */
export function dotLabel(dot: string, now = new Date()): string {
  if (!/^\d{4}$/.test(dot)) return "";
  const week = Number(dot.slice(0, 2));
  const yy = Number(dot.slice(2));
  const currentYY = now.getUTCFullYear() % 100;
  const century = yy <= currentYY ? Math.floor(now.getUTCFullYear() / 100) : Math.floor(now.getUTCFullYear() / 100) - 1;
  return `${century * 100 + yy}年${week}週`;
}

/** タイヤサイズ（195/45R16 84W 等）。形が合わなければ入力そのままを返す（弾かない） */
export function normalizeTireSize(raw: string): string {
  const s = toHalfWidth(raw).toUpperCase().replace(/\s+/g, " ");
  const m = s.match(/(\d{3})\s*\/\s*(\d{2})\s*(Z?R)\s*(\d{2})(?:\s+(\d{2,3}[A-Z]))?/);
  if (!m) return s;
  return `${m[1]}/${m[2]}${m[3]}${m[4]}${m[5] ? ` ${m[5]}` : ""}`;
}

/** 走行距離（数字のみ・7桁まで）。単位や区切りは落とす */
export function normalizeOdometer(raw: string): string {
  const digits = toHalfWidth(raw).replace(/\D/g, "");
  if (!digits || digits.length > 7) return "";
  return String(Number(digits));
}

/** SOH（0〜100の数値） */
export function normalizeSoh(raw: string): string {
  const t = toHalfWidth(raw).replace(/[^\d.]/g, "");
  if (!t) return "";
  const n = Number(t);
  if (!Number.isFinite(n) || n < 0 || n > 100) return "";
  return String(n);
}

/** ロット番号・製品名などの文字列（記号は残す。空白だけ整える） */
export function normalizeLabelText(raw: string): string {
  return toHalfWidth(raw).replace(/\s+/g, " ").slice(0, 60);
}

/**
 * 読み取り結果の正規化と点検。
 * 「読めたが形が変」なものは値を残したうえで警告する（店舗が写真と見比べて直せるように）。
 */
export function normalizeOcrValues(target: OcrTarget, raw: OcrValues, now = new Date()): PhotoOcrResult {
  const values: OcrValues = {};
  const notes: string[] = [];
  const warnings: string[] = [];

  if (target === "product_label") {
    values.product_name = normalizeLabelText(raw.product_name ?? "");
    values.maker = normalizeLabelText(raw.maker ?? "");
    values.lot_no = normalizeLabelText(raw.lot_no ?? "");
    if (!values.lot_no) warnings.push("ロット番号が読み取れませんでした。ラベルを大きく写して撮り直すか手入力してください");
    if (!values.product_name) warnings.push("製品名が読み取れませんでした");
  }

  if (target === "tire") {
    values.brand = normalizeLabelText(raw.brand ?? "");
    values.size = normalizeTireSize(raw.size ?? "");
    const dot = normalizeDot(raw.dot ?? "");
    values.dot = dot;
    if (!dot) {
      warnings.push("DOT（製造週4桁）が読み取れませんでした。刻印部分を撮り直すか手入力してください");
    } else {
      notes.push(`DOT ${dot} = ${dotLabel(dot, now)}`);
    }
    if (!values.size) warnings.push("サイズが読み取れませんでした");
  }

  if (target === "meter") {
    values.odometer_km = normalizeOdometer(raw.odometer_km ?? "");
    if (!values.odometer_km) warnings.push("走行距離が読み取れませんでした。数字がはっきり写るように撮り直してください");
  }

  if (target === "device_screen") {
    values.soh = normalizeSoh(raw.soh ?? "");
    values.measured_label = normalizeLabelText(raw.measured_label ?? "");
    values.measured_value = normalizeLabelText(raw.measured_value ?? "");
    if (!values.soh && !values.measured_value) warnings.push("測定値が読み取れませんでした");
  }

  return { target, values, notes, warnings };
}

// ── AI呼び出し ──

const TOOL: Anthropic.Tool = {
  name: "report_photo_values",
  description: "写真から読み取った値を報告する。読み取れない項目は空文字にする。",
  input_schema: {
    type: "object",
    properties: {
      product_name: { type: "string", description: "製品名（製品ラベルの場合）" },
      maker: { type: "string", description: "メーカー名（製品ラベルの場合）" },
      lot_no: { type: "string", description: "ロット番号／製造番号（製品ラベルの場合。見えたとおり）" },
      brand: { type: "string", description: "タイヤの銘柄（例: PROXES SPORT2）" },
      size: { type: "string", description: "タイヤサイズ（例: 195/45R16 84W）" },
      dot: { type: "string", description: "DOT刻印の末尾4桁（週2桁＋年下2桁。例: 3223）" },
      odometer_km: { type: "string", description: "メーターの走行距離（数字のみ。トリップメーターと混同しない）" },
      soh: { type: "string", description: "SOH（%）。表示があれば数値のみ" },
      measured_label: { type: "string", description: "測定項目の名前（画面に表示されている項目名）" },
      measured_value: { type: "string", description: "測定値（単位を含めてよい）" },
      unreadable: { type: "boolean", description: "対象が写っていない・ぼやけて読めない場合は true" },
    },
    required: ["unreadable"],
    additionalProperties: false,
  },
};

const SYSTEM = `あなたは自動車整備の記録係です。写真に写っている文字・数字をそのまま転記します。

厳守事項:
- 推測・補完・訂正をしない。読めない項目は空文字にする（誤った記録は証明書を無価値にします）
- DOTはタイヤ側面の刻印の末尾4桁（週2桁＋年下2桁）。他の刻印（サイズやロードインデックス）と混同しない
- メーターは総走行距離（ODO）を読む。トリップメーター（TRIP A/B）の値を答えない
- 製品ラベルのロット番号は英数字と記号をそのまま。似た文字（O/0, I/1）を勝手に直さない
- 対象が写っていない場合は unreadable=true にする`;

const TARGET_PROMPT: Record<OcrTarget, string> = {
  product_label: "この製品ラベルから 製品名・メーカー・ロット番号 を報告してください。",
  tire: "このタイヤ側面から 銘柄・サイズ・DOTの末尾4桁 を報告してください。",
  meter: "このメーターから総走行距離（ODO）を報告してください。",
  device_screen: "この測定器の画面から測定項目と測定値（SOHがあれば数値）を報告してください。",
};

export async function readPhotoValues(
  target: OcrTarget,
  image: Buffer,
  mediaType: "image/jpeg" | "image/png" | "image/webp" = "image/jpeg",
): Promise<{ result?: PhotoOcrResult; error?: string }> {
  if (!photoOcrEnabled()) return { error: "読み取り機能が未設定です（本部にお問い合わせください）" };
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let msg: Anthropic.Message;
  try {
    msg = await client.messages.create({
      model: MODEL,
      max_tokens: 600,
      system: SYSTEM,
      tools: [TOOL],
      tool_choice: { type: "tool", name: "report_photo_values" },
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: mediaType, data: image.toString("base64") } },
            { type: "text", text: TARGET_PROMPT[target] },
          ],
        },
      ],
    });
  } catch (e) {
    console.error("mbPIT: 写真の読み取りに失敗", e instanceof Error ? e.message : "unknown");
    return { error: "読み取りに失敗しました。もう一度撮影するか、手入力で進めてください" };
  }
  const block = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!block) return { error: "読み取り結果を受け取れませんでした。手入力で進めてください" };
  const input = block.input as OcrValues & { unreadable?: boolean };
  if (input.unreadable) {
    return { error: "写真から読み取れませんでした。明るい場所で対象に寄って撮影してください" };
  }
  return { result: normalizeOcrValues(target, input) };
}
