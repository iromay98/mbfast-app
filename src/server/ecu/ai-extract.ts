import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "@/lib/db";
import { extractIdCandidates } from "@/server/ecu/candidates";

// Claude による識別子(Cal/SW/HW)の識別。パターンに頼らずASCII候補から推定する。
// ・ANTHROPIC_API_KEY 未設定なら無効（null を返し、呼び出し側はパターンにフォールバック）。
// ・同一ファイル(hash)は EcuAiCache で再呼び出ししない。
// ・Haiku で試し、確信度が低ければ Opus にエスカレーション。

export type AiIds = {
  hw: string | null;
  sw: string | null;
  cal: string | null;
  confidence: number; // 0-1
  model: string; // "haiku" | "opus"
};

// 精度優先: 既定は Opus 単発。コスト優先にしたい場合は ANTHROPIC_MODEL_STRONG を Haiku に。
const PRIMARY = process.env.ANTHROPIC_MODEL_STRONG ?? "claude-opus-4-8";

export function aiEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

const TOOL: Anthropic.Tool = {
  name: "report_ecu_ids",
  description:
    "Report the identified ECU identifiers extracted from the candidate strings of an ECU firmware dump.",
  input_schema: {
    type: "object",
    properties: {
      cal: {
        type: ["string", "null"],
        description:
          "Calibration number (Cal). Often the software number plus a version suffix, e.g. '8V0907404_0004'. null if not identifiable.",
      },
      sw: {
        type: ["string", "null"],
        description: "Software number, e.g. '8V0907404' or a Bosch/Continental SW id. null if unknown.",
      },
      hw: {
        type: ["string", "null"],
        description: "Hardware part number, e.g. '07K907309C'. null if unknown.",
      },
      confidence: {
        type: "number",
        description: "Confidence 0..1 that the identifiers (especially Cal) are correct.",
      },
      reasoning: { type: "string", description: "Brief reasoning (1-2 sentences)." },
    },
    required: ["cal", "sw", "hw", "confidence"],
  },
};

function buildPrompt(
  candidates: string[],
  ctx: {
    manufacturer?: string | null;
    ecuType?: string | null;
    method?: string | null;
    swHint?: string | null;
    calHint?: string | null;
    engineCode?: string | null;
    engineDesc?: string | null;
  },
): string {
  return [
    "You are an expert at reading automotive ECU firmware identifier blocks.",
    "From the candidate ASCII strings extracted from a decrypted ECU dump, identify the vehicle's",
    "Calibration number (Cal), Software number (SW) and Hardware part number (HW).",
    "",
    `Manufacturer: ${ctx.manufacturer ?? "(unknown)"}`,
    `ECU: ${ctx.ecuType ?? "(unknown)"}`,
    `Engine: ${ctx.engineDesc ?? ctx.engineCode ?? "(unknown)"}`,
    `Read method: ${ctx.method ?? "(unknown)"}`,
    ctx.swHint ? `SW hint (from pattern matching): ${ctx.swHint}` : "",
    ctx.calHint
      ? `Cal candidate from pattern matching: ${ctx.calHint} — verify it against the candidates; keep it if consistent (it may include a version suffix that is split across candidate tokens), correct it only if clearly wrong.`
      : "",
    "",
    "Guidance:",
    "- Cal is the most important. It is often the SW number followed by a version suffix (e.g. '8V0907404_0004' or '8V0907404 0004'). The version suffix may appear as a separate short token.",
    "- Prefer identifiers that appear together in the firmware identification block.",
    "",
    "CRITICAL — avoid false positives:",
    "- Many 10-digit numbers in the dump are NOT part numbers: Unix timestamps (10 digits starting with 1, e.g. 15xxxxxxxx / 16xxxxxxxx / 17xxxxxxxx ≈ years 2017-2024), checksums, addresses, dates. NEVER report these as Cal/SW/HW.",
    "- For Mercedes-Benz: real part numbers are 10 digits usually starting with the engine/family number (e.g. M276 engine → '276xxxxxxx', often written 'A276...' or grouped like '276 901 02 04'). Strongly PREFER candidates that start with the engine family digits over generic 10-digit numbers.",
    "- For VAG: part numbers look like '8V0907404' (letters+digits), hardware like '07K907309C'.",
    "- If the only plausible value looks like a timestamp/checksum, return null and lower confidence rather than reporting a wrong value.",
    "- Do NOT invent values that are not among the candidates (the pattern Cal hint is the only exception).",
    "",
    "Candidate strings (deduplicated, ranked):",
    candidates.join("  "),
    "",
    "Call report_ecu_ids with your answer.",
  ]
    .filter(Boolean)
    .join("\n");
}

async function callModel(
  client: Anthropic,
  model: string,
  prompt: string,
): Promise<Omit<AiIds, "model"> | null> {
  const msg = await client.messages.create({
    model,
    max_tokens: 600,
    tools: [TOOL],
    tool_choice: { type: "tool", name: "report_ecu_ids" },
    messages: [{ role: "user", content: prompt }],
  });
  const block = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!block) return null;
  const inp = block.input as {
    cal?: string | null;
    sw?: string | null;
    hw?: string | null;
    confidence?: number;
  };
  const norm = (s?: string | null) => {
    const t = (s ?? "").trim();
    return t && t.toLowerCase() !== "null" ? t : null;
  };
  return {
    hw: norm(inp.hw),
    sw: norm(inp.sw),
    cal: norm(inp.cal),
    confidence: typeof inp.confidence === "number" ? Math.max(0, Math.min(1, inp.confidence)) : 0,
  };
}

export async function aiExtractIds(
  buf: Buffer,
  ctx: {
    hash?: string | null;
    manufacturer?: string | null;
    ecuType?: string | null;
    method?: string | null;
    swHint?: string | null;
    calHint?: string | null;
    engineCode?: string | null;
    engineDesc?: string | null;
    throwOnError?: boolean; // 手動再判定では API エラーを表に出す
    force?: boolean; // キャッシュを無視して再呼び出し＋上書き（手動再判定）
  },
): Promise<AiIds | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  // キャッシュ（同一ファイルは再呼び出ししない。force 指定時は無視して読み直す）
  if (ctx.hash && !ctx.force) {
    const cached = await prisma.ecuAiCache.findUnique({ where: { hash: ctx.hash } });
    if (cached) {
      return {
        hw: cached.hw,
        sw: cached.sw,
        cal: cached.cal,
        confidence: cached.confidence ?? 0,
        model: cached.model ?? "cache",
      };
    }
  }

  const candidates = extractIdCandidates(buf);
  if (candidates.length === 0) return null;
  const prompt = buildPrompt(candidates, ctx);
  const client = new Anthropic({ apiKey });

  const usedModel = PRIMARY.includes("haiku") ? "haiku" : "opus";
  let res: Omit<AiIds, "model"> | null = null;
  try {
    res = await callModel(client, PRIMARY, prompt);
  } catch (e) {
    console.error("AI識別子抽出に失敗", e);
    if (ctx.throwOnError) {
      const status = (e as { status?: number })?.status;
      const msg = e instanceof Error ? e.message : String(e);
      throw new Error(`AI APIエラー${status ? `(${status})` : ""}: ${msg}`);
    }
    return null;
  }
  if (!res) return null;

  const out: AiIds = { ...res, model: usedModel };
  if (ctx.hash) {
    await prisma.ecuAiCache
      .upsert({
        where: { hash: ctx.hash },
        create: {
          hash: ctx.hash,
          hw: out.hw,
          sw: out.sw,
          cal: out.cal,
          confidence: out.confidence,
          model: usedModel,
        },
        // 新たに呼び出した結果で上書き（force 再判定で古い誤値を更新）
        update: { hw: out.hw, sw: out.sw, cal: out.cal, confidence: out.confidence, model: usedModel },
      })
      .catch(() => {});
  }
  return out;
}
