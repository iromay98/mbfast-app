import crypto from "node:crypto";
import { prisma } from "@/lib/db";
import {
  AutotunerError,
  type DecryptResponse,
  type DecryptResult,
  type EncryptIds,
  type EncryptResult,
} from "./types";

/*
 * AutoTuner Master API クライアント。
 * 参照実装 master-api-decrypt.php に厳密準拠：
 *   POST {base}/decrypt
 *   headers: Content-Type: application/json, X-Autotuner-Id, X-Autotuner-API-Key
 *   body: { mode: "maps", data: <slaveのBase64> }
 *   200: data を base64 デコードし sha256 を計算、strtoupper が hash と一致するか検証
 * 429/503 は指数バックオフで再試行（上限あり）。それ以外の非200は即失敗。
 */

const BASE =
  process.env.AUTOTUNER_API_BASE ??
  "https://api.autotuner-tool.com/v2/api/v1/master";
const TIMEOUT_MS = Number(process.env.AUTOTUNER_TIMEOUT_MS ?? 30000);
const MAX_RETRIES = Number(process.env.AUTOTUNER_MAX_RETRIES ?? 5);

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function logCall(
  recordId: string | undefined,
  mode: string,
  httpStatus: number | null,
  success: boolean,
  error?: string,
): Promise<void> {
  try {
    await prisma.autotunerApiLog.create({
      data: { recordId: recordId ?? null, mode, httpStatus, success, error: error ?? null },
    });
  } catch {
    // ログ失敗は本処理を止めない
  }
}

/**
 * スレーブバイナリを decrypt で復号する。検証済みの結果を返す。失敗時は AutotunerError。
 * mode: "maps"=マップ部分のみ（既定） / "backup"=ECU全内容（bak・マップスイッチ用）。
 * backup 非対応ECU（backup_supported=false）では API が 412 を返す。
 */
export async function decryptSlave(
  slave: Buffer,
  opts: { recordId?: string; mode?: "maps" | "backup" } = {},
): Promise<DecryptResult> {
  const mode = opts.mode ?? "maps";
  const id = process.env.AUTOTUNER_ID;
  const key = process.env.AUTOTUNER_API_KEY;
  if (!id || !key) {
    await logCall(opts.recordId, mode, null, false, "認証情報(AUTOTUNER_ID/API_KEY)が未設定");
    throw new AutotunerError(
      "AutoTuner の認証情報(AUTOTUNER_ID / AUTOTUNER_API_KEY)が未設定です",
      null,
      "AUTH_MISSING",
    );
  }

  const body = JSON.stringify({ mode, data: slave.toString("base64") });

  let lastErr: AutotunerError | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${BASE}/decrypt`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Autotuner-Id": id,
          "X-Autotuner-API-Key": key,
        },
        body,
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      const msg = e instanceof Error ? e.message : String(e);
      await logCall(opts.recordId, mode, null, false, `network: ${msg}`);
      lastErr = new AutotunerError(`通信エラー: ${msg}`, null, "NETWORK");
      // ネットワーク失敗も指数バックオフで再試行
      if (attempt < MAX_RETRIES) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw lastErr;
    }
    clearTimeout(timer);

    if (res.status === 200) {
      let json: DecryptResponse;
      try {
        json = (await res.json()) as DecryptResponse;
      } catch {
        await logCall(opts.recordId, mode, 200, false, "JSON解析失敗");
        throw new AutotunerError("レスポンスJSONの解析に失敗", 200, "BAD_RESPONSE");
      }
      // ハッシュ検証（参照PHP準拠）
      const decryptedData = Buffer.from(json.data ?? "", "base64");
      const computed = crypto
        .createHash("sha256")
        .update(decryptedData)
        .digest("hex")
        .toUpperCase();
      if (!json.hash || computed !== json.hash.toUpperCase()) {
        await logCall(opts.recordId, mode, 200, false, "hash不一致");
        throw new AutotunerError(
          "復号データのハッシュが一致しません（破損の可能性）",
          200,
          "HASH_MISMATCH",
        );
      }
      await logCall(opts.recordId, mode, 200, true);
      return { meta: json, decryptedData, hash: json.hash.toUpperCase() };
    }

    // レート制限 / 未準備 は再試行対象
    if (res.status === 429 || res.status === 503) {
      await logCall(opts.recordId, mode, res.status, false, `retryable ${res.status}`);
      lastErr = new AutotunerError(
        res.status === 429 ? "レート制限(429)" : "サーバー未準備(503)",
        res.status,
        res.status === 429 ? "RATE_LIMITED" : "UNAVAILABLE",
      );
      if (attempt < MAX_RETRIES) {
        const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
        await sleep(retryAfter ?? backoffMs(attempt));
        continue;
      }
      throw lastErr;
    }

    // その他の非200は即失敗（400/401/405/406/412/500 等）
    const text = await safeText(res);
    await logCall(opts.recordId, mode, res.status, false, text.slice(0, 300));
    throw new AutotunerError(
      `APIエラー HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
      res.status,
      "HTTP_ERROR",
    );
  }
  // ループを抜けた（理論上到達しない）
  throw lastErr ?? new AutotunerError("decrypt に失敗", null, "NETWORK");
}

/**
 * チューニング済みバイナリを encrypt(maps) で再暗号化し、その車で焼ける .slave を得る。
 * decryptSlave の鏡写し：POST {base}/encrypt, body { mode:"maps", data, slave_id, ecu_id, model_id, mcu_id }。
 * 200 で data(=.slaveのbase64) を取り出し、sha256(出力)==hash を検証して返す。
 * ids は復号時に保存した ServiceRecord の autotunerSlaveId/EcuId/ModelId/McuId を渡すこと（その車固有）。
 */
export async function encryptSlave(
  tuned: Buffer,
  ids: EncryptIds,
  opts: { recordId?: string; mode?: "maps" | "backup" } = {},
): Promise<EncryptResult> {
  const mode = opts.mode ?? "maps";
  const id = process.env.AUTOTUNER_ID;
  const key = process.env.AUTOTUNER_API_KEY;
  if (!id || !key) {
    await logCall(opts.recordId, `encrypt-${mode}`, null, false, "認証情報(AUTOTUNER_ID/API_KEY)が未設定");
    throw new AutotunerError(
      "AutoTuner の認証情報(AUTOTUNER_ID / AUTOTUNER_API_KEY)が未設定です",
      null,
      "AUTH_MISSING",
    );
  }

  const body = JSON.stringify({
    mode,
    data: tuned.toString("base64"),
    slave_id: ids.slaveId,
    ecu_id: ids.ecuId,
    model_id: ids.modelId,
    mcu_id: ids.mcuId,
  });

  let lastErr: AutotunerError | null = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(`${BASE}/encrypt`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Autotuner-Id": id,
          "X-Autotuner-API-Key": key,
        },
        body,
        signal: controller.signal,
      });
    } catch (e) {
      clearTimeout(timer);
      const msg = e instanceof Error ? e.message : String(e);
      await logCall(opts.recordId, `encrypt-${mode}`, null, false, `network: ${msg}`);
      lastErr = new AutotunerError(`通信エラー: ${msg}`, null, "NETWORK");
      if (attempt < MAX_RETRIES) {
        await sleep(backoffMs(attempt));
        continue;
      }
      throw lastErr;
    }
    clearTimeout(timer);

    if (res.status === 200) {
      let json: DecryptResponse;
      try {
        json = (await res.json()) as DecryptResponse;
      } catch {
        await logCall(opts.recordId, `encrypt-${mode}`, 200, false, "JSON解析失敗");
        throw new AutotunerError("レスポンスJSONの解析に失敗", 200, "BAD_RESPONSE");
      }
      const slaveData = Buffer.from(json.data ?? "", "base64");
      const computed = crypto
        .createHash("sha256")
        .update(slaveData)
        .digest("hex")
        .toUpperCase();
      if (!json.hash || computed !== json.hash.toUpperCase()) {
        await logCall(opts.recordId, `encrypt-${mode}`, 200, false, "hash不一致");
        throw new AutotunerError(
          "暗号化データのハッシュが一致しません（破損の可能性）",
          200,
          "HASH_MISMATCH",
        );
      }
      await logCall(opts.recordId, `encrypt-${mode}`, 200, true);
      return { slaveData, hash: json.hash.toUpperCase() };
    }

    if (res.status === 429 || res.status === 503) {
      await logCall(opts.recordId, `encrypt-${mode}`, res.status, false, `retryable ${res.status}`);
      lastErr = new AutotunerError(
        res.status === 429 ? "レート制限(429)" : "サーバー未準備(503)",
        res.status,
        res.status === 429 ? "RATE_LIMITED" : "UNAVAILABLE",
      );
      if (attempt < MAX_RETRIES) {
        const retryAfter = parseRetryAfter(res.headers.get("retry-after"));
        await sleep(retryAfter ?? backoffMs(attempt));
        continue;
      }
      throw lastErr;
    }

    const text = await safeText(res);
    await logCall(opts.recordId, `encrypt-${mode}`, res.status, false, text.slice(0, 300));
    throw new AutotunerError(
      `APIエラー HTTP ${res.status}${text ? `: ${text.slice(0, 200)}` : ""}`,
      res.status,
      "HTTP_ERROR",
    );
  }
  throw lastErr ?? new AutotunerError("encrypt に失敗", null, "NETWORK");
}

// 指数バックオフ（1s, 2s, 4s, ... + ジッタ、上限30s）
function backoffMs(attempt: number): number {
  const base = Math.min(1000 * 2 ** attempt, 30000);
  return base + Math.floor(Math.random() * 500);
}

function parseRetryAfter(v: string | null): number | null {
  if (!v) return null;
  const sec = Number(v);
  return Number.isFinite(sec) && sec >= 0 ? Math.min(sec * 1000, 60000) : null;
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
