/*
 * AutoTuner Master API の型（master-api.txt の Objects/decrypt 定義に厳密準拠）。
 * 推測でフィールドを足さないこと。
 */

// engine オブジェクト
export type AutotunerEngine = {
  name: string; // engine name
  version: string | null; // nullable
  year_from: number; // short
  year_to: number | null; // nullable
  power: number | null; // hp, nullable
  torque: number | null; // Nm, nullable
  fuel: string; // fuel name
};

// decrypt サービスの 200 レスポンス
export type DecryptResponse = {
  mode: string;
  backup_supported: boolean;
  slave_id: string; // encrypt で必要
  slave_name: string;
  timestamp: number; // ms since epoch
  mcu_id: string; // encrypt で必要
  mcu: string;
  ecu_id: number; // encrypt で必要
  ecu: string;
  ecu_manufacturer: string;
  method: string; // 読み方式
  manufacturer_id: number;
  manufacturer: string;
  engine: AutotunerEngine;
  model_id: number; // encrypt で必要
  model: string;
  hash: string; // 復号バイナリの SHA-256（大文字16進）
  data: string; // 復号データ（Base64）
};

// decryptSlave の戻り値（検証済み）
export type DecryptResult = {
  meta: DecryptResponse;
  decryptedData: Buffer; // base64 デコード済み・hash 検証済み
  hash: string; // 大文字 SHA-256
};

// encrypt に必要な ID 群（復号時に ServiceRecord へ保存済み）。
export type EncryptIds = {
  slaveId: string; // ← decrypt: slave_id
  ecuId: number; // ← decrypt: ecu_id
  modelId: number; // ← decrypt: model_id
  mcuId: string; // ← decrypt: mcu_id
};

// encryptSlave の戻り値（検証済み）。encrypt は decrypt と同形のレスポンス：
//   data = .slave の base64 / hash = 出力(.slave) の SHA-256（大文字）
export type EncryptResult = {
  slaveData: Buffer; // 再暗号化された .slave（base64デコード済み・hash検証済み）
  hash: string; // 出力(.slave)の大文字 SHA-256
};

// 失敗を表す型付きエラー
export class AutotunerError extends Error {
  constructor(
    message: string,
    readonly httpStatus: number | null,
    readonly kind:
      | "AUTH_MISSING" // 認証情報未設定
      | "HTTP_ERROR" // 4xx/5xx（再試行しない）
      | "RATE_LIMITED" // 429（再試行上限到達）
      | "UNAVAILABLE" // 503（再試行上限到達）
      | "HASH_MISMATCH" // ハッシュ不一致＝破損
      | "NETWORK" // ネットワーク/タイムアウト
      | "BAD_RESPONSE", // JSON 不正
  ) {
    super(message);
    this.name = "AutotunerError";
  }
}
