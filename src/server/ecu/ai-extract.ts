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
  // AutoTunerメタ＋dumpから推定した車両情報（例: grade="S550", generation="W222"）
  grade: string | null;
  generation: string | null;
  confidence: number; // 0-1
  model: string; // "haiku" | "opus"
};

// 精度優先: 既定は Opus 単発。コスト優先にしたい場合は ANTHROPIC_MODEL_STRONG を Haiku に。
const PRIMARY = process.env.ANTHROPIC_MODEL_STRONG ?? "claude-opus-4-8";
// このファイル以外に何件で「共通の定数」とみなして候補から外すか。
const COMMON_THRESHOLD = Number(process.env.ECU_COMMON_THRESHOLD ?? "3");

// 拒否リスト（AIがCal等と誤認しがちな共通定数）。候補から無条件に除外する。
async function filterDenied(candidates: string[]): Promise<string[]> {
  try {
    const deny = await prisma.ecuDenyToken.findMany({
      where: { token: { in: candidates } },
      select: { token: true },
    });
    if (deny.length === 0) return candidates;
    const set = new Set(deny.map((d) => d.token));
    return candidates.filter((t) => !set.has(t));
  } catch {
    return candidates;
  }
}

export function aiEnabled(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

// 候補トークンを記録だけする（API不要）。共通定数フィルタの学習を先に回すため。
export async function recordCandidateTokens(
  buf: Buffer,
  hash: string | null | undefined,
): Promise<void> {
  if (!hash) return;
  const candidates = extractIdCandidates(buf);
  if (candidates.length === 0) return;
  await prisma.ecuTokenSeen
    .createMany({
      data: candidates.slice(0, 80).map((t) => ({ token: t, hash })),
      skipDuplicates: true,
    })
    .catch(() => {});
}

// 本店の修正を次に活かす: ①AIキャッシュの誤値を消す ②few-shot例として記録。
export async function recordCorrection(opts: {
  manufacturer?: string | null;
  ecu?: string | null;
  hash?: string | null;
  cal?: string | null;
  sw?: string | null;
  hw?: string | null;
}): Promise<void> {
  if (opts.hash) {
    // AIが出していた値と本店の確定値が食い違うCalは「誤認しやすい値」として拒否リストに学習
    try {
      const cached = await prisma.ecuAiCache.findUnique({ where: { hash: opts.hash } });
      if (cached?.cal && opts.cal && cached.cal !== opts.cal) {
        await prisma.ecuDenyToken.upsert({
          where: { token: cached.cal },
          create: { token: cached.cal, note: `本店の手修正で否定（正: ${opts.cal}）` },
          update: {},
        });
      }
    } catch {
      /* 学習失敗は無視 */
    }
    await prisma.ecuAiCache.deleteMany({ where: { hash: opts.hash } }).catch(() => {});
  }
  if (opts.manufacturer && (opts.cal || opts.sw || opts.hw)) {
    await prisma.ecuExample
      .create({
        data: {
          manufacturer: opts.manufacturer,
          ecu: opts.ecu ?? null,
          cal: opts.cal ?? null,
          sw: opts.sw ?? null,
          hw: opts.hw ?? null,
        },
      })
      .catch(() => {});
  }
}

// AIに渡す「確定済みの正解例」（メーカー一致を優先、無ければ最近のもの）。
async function loadExamples(manufacturer?: string | null, limit = 6): Promise<string> {
  try {
    let ex = manufacturer
      ? await prisma.ecuExample.findMany({
          where: { manufacturer },
          orderBy: { createdAt: "desc" },
          take: limit,
        })
      : [];
    if (ex.length === 0) {
      ex = await prisma.ecuExample.findMany({ orderBy: { createdAt: "desc" }, take: limit });
    }
    if (ex.length === 0) return "";
    const lines = ex.map(
      (e) => `- ${e.manufacturer}${e.ecu ? ` (${e.ecu})` : ""}: Cal=${e.cal ?? "-"} SW=${e.sw ?? "-"} HW=${e.hw ?? "-"}`,
    );
    return [
      "Known-correct examples previously confirmed by the operator (learn the FORMAT/pattern of Cal/SW/HW for each manufacturer from these):",
      ...lines,
    ].join("\n");
  } catch {
    return "";
  }
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
      grade: {
        type: ["string", "null"],
        description:
          "Vehicle trim/grade inferred from manufacturer/model/engine info, e.g. 'S550', '440i', 'RS3'. null if not determinable with reasonable confidence.",
      },
      generation: {
        type: ["string", "null"],
        description: "Generation/chassis code, e.g. 'W222', 'G22', '8V'. null if unsure.",
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
  examples = "",
): string {
  return [
    "You are an expert at reading automotive ECU firmware identifier blocks.",
    "From the candidate ASCII strings extracted from a decrypted ECU dump, identify the vehicle's",
    "Calibration number (Cal), Software number (SW) and Hardware part number (HW).",
    "",
    examples,
    examples ? "" : null,
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
    "- Also infer the vehicle trim/grade (e.g. 'S550', '440i') and generation/chassis code (e.g. 'W222', 'G22') from the Manufacturer/Model/Engine information when clearly determinable (engine family + power output usually pins it down). Return null if ambiguous.",
    "",
    "CRITICAL — pick the value that identifies THIS vehicle, not a generic constant:",
    "- The Cal/SW/HW must be specific to this ECU's identifier. Some 10-digit numbers recur across many unrelated dumps (shared library/firmware constants) — they are NOT this vehicle's Cal even though they look like a part number. Candidates already had cross-file common constants removed, but stay skeptical of any value that does not fit the vehicle.",
    "- For Mercedes-Benz: real part numbers are 10 digits usually starting with the engine/family number (e.g. M276 engine → '276xxxxxxx', often written 'A276...' or grouped like '276 901 02 04'). Strongly PREFER candidates that start with the engine family digits.",
    "- For VAG: part numbers look like '8V0907404' (letters+digits), hardware like '07K907309C'.",
    "- If no candidate clearly fits this vehicle's identifier, return null and a low confidence rather than guessing a generic-looking number.",
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
    grade?: string | null;
    generation?: string | null;
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
    grade: norm(inp.grade),
    generation: norm(inp.generation),
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
        grade: null, // キャッシュには車両推定を持たない（識別子のみ）
        generation: null,
        confidence: cached.confidence ?? 0,
        model: cached.model ?? "cache",
      };
    }
  }

  let candidates = extractIdCandidates(buf);
  if (candidates.length === 0) return null;

  // 拒否リスト（既知の誤認定数）を無条件に除外
  candidates = await filterDenied(candidates);
  // 複数の無関係なファイルに共通して出るトークン（＝定数。或る車のCalが別車にも出る等）を
  // AI候補から除外する。学習データはファイルを処理するほど溜まる。
  let usable = candidates;
  if (ctx.hash) {
    try {
      const common = await prisma.ecuTokenSeen.groupBy({
        by: ["token"],
        where: { token: { in: candidates }, hash: { not: ctx.hash } },
        _count: { hash: true },
        having: { hash: { _count: { gte: COMMON_THRESHOLD } } },
      });
      const commonSet = new Set(common.map((c) => c.token));
      if (commonSet.size > 0) {
        const f = candidates.filter((t) => !commonSet.has(t));
        if (f.length >= 8) usable = f; // 消しすぎたら元に戻す
      }
      // このファイルの候補を記録（成長させる。肥大化防止に上位80のみ）
      await prisma.ecuTokenSeen
        .createMany({
          data: candidates.slice(0, 80).map((t) => ({ token: t, hash: ctx.hash! })),
          skipDuplicates: true,
        })
        .catch(() => {});
    } catch {
      /* 集計失敗時はフィルタなしで続行 */
    }
  }

  const examples = await loadExamples(ctx.manufacturer);
  const prompt = buildPrompt(usable, ctx, examples);
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

// ── 純正binアップ用: 車両(メーカー/車種/世代/グレード)＋識別子(HW/SW/Cal)をAIで推定 ──

export type AiStock = {
  manufacturer: string | null;
  model: string | null;
  generation: string | null;
  grade: string | null;
  hw: string | null;
  sw: string | null;
  cal: string | null;
  confidence: number;
};

const STOCK_TOOL: Anthropic.Tool = {
  name: "report_stock",
  description: "Report the vehicle and ECU identifiers inferred from an ECU firmware dump.",
  input_schema: {
    type: "object",
    properties: {
      manufacturer: { type: ["string", "null"], description: "Vehicle manufacturer, e.g. 'Audi', 'Mercedes', 'BMW'. null if unsure." },
      model: { type: ["string", "null"], description: "Model / series, e.g. 'RS3', 'C-class'. null if unsure." },
      generation: { type: ["string", "null"], description: "Generation/chassis code, e.g. '8V', 'W205'. null if unsure." },
      grade: { type: ["string", "null"], description: "Grade/trim, e.g. 'S550', 'C43'. null if unsure." },
      cal: { type: ["string", "null"], description: "Calibration number. null if not identifiable." },
      sw: { type: ["string", "null"], description: "Software number. null if unknown." },
      hw: { type: ["string", "null"], description: "Hardware part number. null if unknown." },
      confidence: { type: "number", description: "Confidence 0..1 for the overall result." },
      reasoning: { type: "string", description: "Brief reasoning." },
    },
    required: ["manufacturer", "model", "cal", "sw", "hw", "confidence"],
  },
};

// 共通の候補準備（抽出＋共通定数フィルタ＋記録）。
async function prepCandidates(buf: Buffer, hash: string | null | undefined): Promise<string[]> {
  let candidates = extractIdCandidates(buf);
  candidates = await filterDenied(candidates); // 既知の誤認定数を無条件除外
  if (candidates.length === 0 || !hash) return candidates;
  let usable = candidates;
  try {
    const common = await prisma.ecuTokenSeen.groupBy({
      by: ["token"],
      where: { token: { in: candidates }, hash: { not: hash } },
      _count: { hash: true },
      having: { hash: { _count: { gte: COMMON_THRESHOLD } } },
    });
    const commonSet = new Set(common.map((c) => c.token));
    if (commonSet.size > 0) {
      const f = candidates.filter((t) => !commonSet.has(t));
      if (f.length >= 8) usable = f;
    }
    await prisma.ecuTokenSeen
      .createMany({
        data: candidates.slice(0, 80).map((t) => ({ token: t, hash })),
        skipDuplicates: true,
      })
      .catch(() => {});
  } catch {
    /* フィルタ無しで続行 */
  }
  return usable;
}

export async function aiAnalyzeStock(
  buf: Buffer,
  ctx: { hash?: string | null; swHint?: string | null; calHint?: string | null; engineDesc?: string | null; throwOnError?: boolean },
): Promise<AiStock | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    if (ctx.throwOnError) throw new Error("AIキー(ANTHROPIC_API_KEY)が未設定です。");
    return null;
  }
  const usable = await prepCandidates(buf, ctx.hash);
  if (usable.length === 0) return null;

  const examples = await loadExamples(null);
  const prompt = [
    "You are an expert at reading automotive ECU firmware dumps.",
    "From the candidate strings, infer the VEHICLE and the ECU identifiers.",
    "",
    examples,
    ctx.engineDesc ? `Engine description found in dump: ${ctx.engineDesc}` : "",
    ctx.swHint ? `SW hint (pattern): ${ctx.swHint}` : "",
    ctx.calHint ? `Cal hint (pattern): ${ctx.calHint}` : "",
    "",
    "Guidance:",
    "- Infer manufacturer/model/generation/grade from part-number conventions and the engine description, even if the brand name is not literally present.",
    "  Examples: VAG part '8V0907404' → Audi, RS3/S3, generation 8V. '07K907309C' is the hardware. Mercedes 10-digit parts starting with the engine family (e.g. 276…) → Mercedes, engine M276 (often C/E/GLC 43 AMG, 3.0 V6).",
    "- Cal is usually the SW number plus a version suffix (the suffix may be a separate short token).",
    "- Candidates already had cross-file common constants removed. Still, only report a value that identifies THIS vehicle; if unsure return null and lower confidence.",
    "- Do NOT invent values not present among the candidates (the pattern hints are the only exception).",
    "",
    "Candidates (ranked):",
    usable.join("  "),
    "",
    "Call report_stock.",
  ]
    .filter(Boolean)
    .join("\n");

  const client = new Anthropic({ apiKey });
  let msg: Anthropic.Message;
  try {
    msg = await client.messages.create({
      model: PRIMARY,
      max_tokens: 700,
      tools: [STOCK_TOOL],
      tool_choice: { type: "tool", name: "report_stock" },
      messages: [{ role: "user", content: prompt }],
    });
  } catch (e) {
    if (ctx.throwOnError) {
      const status = (e as { status?: number })?.status;
      throw new Error(`AI APIエラー${status ? `(${status})` : ""}: ${e instanceof Error ? e.message : String(e)}`);
    }
    return null;
  }
  const block = msg.content.find((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
  if (!block) return null;
  const inp = block.input as Record<string, unknown>;
  const norm = (v: unknown) => {
    const t = String(v ?? "").trim();
    return t && t.toLowerCase() !== "null" ? t : null;
  };
  return {
    manufacturer: norm(inp.manufacturer),
    model: norm(inp.model),
    generation: norm(inp.generation),
    grade: norm(inp.grade),
    hw: norm(inp.hw),
    sw: norm(inp.sw),
    cal: norm(inp.cal),
    confidence: typeof inp.confidence === "number" ? Math.max(0, Math.min(1, inp.confidence)) : 0,
  };
}
