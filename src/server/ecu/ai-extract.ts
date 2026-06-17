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

const HAIKU = process.env.ANTHROPIC_MODEL_FAST ?? "claude-haiku-4-5-20251001";
const OPUS = process.env.ANTHROPIC_MODEL_STRONG ?? "claude-opus-4-8";
const ESCALATE_BELOW = 0.75;

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
  },
): string {
  return [
    "You are an expert at reading automotive ECU firmware identifier blocks.",
    "From the candidate ASCII strings extracted from a decrypted ECU dump, identify the vehicle's",
    "Calibration number (Cal), Software number (SW) and Hardware part number (HW).",
    "",
    `Manufacturer: ${ctx.manufacturer ?? "(unknown)"}`,
    `ECU: ${ctx.ecuType ?? "(unknown)"}`,
    `Read method: ${ctx.method ?? "(unknown)"}`,
    ctx.swHint ? `SW hint (from pattern matching): ${ctx.swHint}` : "",
    ctx.calHint
      ? `Cal candidate from pattern matching: ${ctx.calHint} — verify it against the candidates; keep it if consistent (it may include a version suffix that is split across candidate tokens), correct it only if clearly wrong.`
      : "",
    "",
    "Guidance:",
    "- Cal is the most important. It is often the SW number followed by a version suffix (e.g. '8V0907404_0004' or '8V0907404 0004'). The version suffix may appear as a separate short token.",
    "- Prefer identifiers that appear together in the firmware identification block.",
    "- For Mercedes-Benz, part numbers look like 10 digits, optionally prefixed with 'A' (e.g. '2769033704' or 'A2769003200').",
    "- If you cannot confidently identify a value, return null for it and lower the confidence.",
    "- Do NOT invent values that are not present among the candidates (the pattern Cal hint is allowed even if its version suffix is not a separate candidate).",
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
  },
): Promise<AiIds | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  // キャッシュ（同一ファイルは再呼び出ししない）
  if (ctx.hash) {
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

  let usedModel = "haiku";
  let res: Omit<AiIds, "model"> | null = null;
  try {
    res = await callModel(client, HAIKU, prompt);
    // 確信度が低い / Cal 取れなかった → Opus にエスカレーション
    if (!res || res.confidence < ESCALATE_BELOW || !res.cal) {
      const strong = await callModel(client, OPUS, prompt);
      if (strong) {
        res = strong;
        usedModel = "opus";
      }
    }
  } catch (e) {
    console.error("AI識別子抽出に失敗", e);
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
        update: {},
      })
      .catch(() => {});
  }
  return out;
}
