// 車両（車のお薬手帳）: 車検証QRの車台番号 → vehicle_key 変換と、QRペイロードの寛容パース。
//
// セキュリティ方針:
//  - 車台番号の平文はDBに保存しない。保存するのは HMAC-SHA256(車台番号, SERVER_SECRET) と下3桁のみ
//  - SERVER_SECRET を知らない第三者は車台番号から vehicleKey を導出できない
//  - SERVER_SECRET は一度発行したら変更しないこと（変更すると既存車両に紐づけ直せなくなる）

import { createHash, createHmac } from "node:crypto";
import { prisma } from "@/lib/db";

export function vehicleFeatureEnabled(): boolean {
  return !!process.env.SERVER_SECRET;
}

// 全角→半角・大文字化・空白/長音等の除去（読取り揺れの正規化）
export function normalizeChassis(raw: string): string {
  return raw
    .replace(/[Ａ-Ｚａ-ｚ０-９－]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "");
}

export function vehicleKeyFromChassis(chassis: string): string {
  const secret = process.env.SERVER_SECRET;
  if (!secret) throw new Error("SERVER_SECRET が未設定です");
  return createHmac("sha256", secret).update(normalizeChassis(chassis)).digest("hex");
}

export type ParsedShakenQr = {
  chassis: string | null; // 車台番号（例: ZC33S-123456 / 17桁VIN）
  modelCode: string | null; // 型式（例: 3BA-ZC33S）
  expiry: Date | null; // 車検有効期限
};

// 車検証QR（複数QRの連結にも対応）の寛容パース。
// 国交省フォーマットは「/」区切りのフィールド列なので、フィールドの形で判定する:
//  - 車台番号: {英数}-{数字4〜8桁} または 17桁VIN
//  - 型式: {排ガス記号}-{英数}（例 3BA-ZC33S, CBA-…, DBA-…）
//  - 有効期限: YYYYMMDD 形式（和暦コード等は対象外＝取れなければ手入力）
export function parseShakenQr(text: string): ParsedShakenQr {
  const fields = text
    .split(/[\/\n\r]+/)
    .map((f) => normalizeChassis(f.trim()))
    .filter(Boolean);

  let chassis: string | null = null;
  let modelCode: string | null = null;
  let expiry: Date | null = null;

  for (const f of fields) {
    if (!modelCode && /^[A-Z0-9]{2,4}-[A-Z][A-Z0-9]{1,9}$/.test(f) && /^\d/.test(f)) {
      // 3BA-ZC33S のような型式（先頭が排ガス規制コード=数字始まり）
      modelCode = f;
      continue;
    }
    if (!chassis && (/^[A-Z][A-Z0-9]{1,9}-\d{4,8}$/.test(f) || /^[A-HJ-NPR-Z0-9]{17}$/.test(f))) {
      chassis = f;
      continue;
    }
    if (!expiry && /^(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(f)) {
      const y = Number(f.slice(0, 4));
      const m = Number(f.slice(4, 6));
      const d = Number(f.slice(6, 8));
      const dt = new Date(Date.UTC(y, m - 1, d));
      if (y >= 2020 && y <= 2050) expiry = dt;
    }
  }
  return { chassis, modelCode, expiry };
}

// 車台番号（またはQR生テキスト）から車両をupsertしてidを返す
export async function upsertVehicle(opts: {
  chassisOrQr: string;
  vehicleName?: string | null;
  inspectionExpiry?: Date | null;
  modelCode?: string | null;
}): Promise<{ id: string; vehicleKey: string } | null> {
  if (!vehicleFeatureEnabled()) return null;
  let chassis = normalizeChassis(opts.chassisOrQr);
  let modelCode = opts.modelCode ?? null;
  let expiry = opts.inspectionExpiry ?? null;
  if (opts.chassisOrQr.includes("/")) {
    const parsed = parseShakenQr(opts.chassisOrQr);
    if (!parsed.chassis) return null;
    chassis = parsed.chassis;
    modelCode = modelCode ?? parsed.modelCode;
    expiry = expiry ?? parsed.expiry;
  }
  if (chassis.length < 6) return null; // 短すぎるものは車台番号とみなさない
  const vehicleKey = vehicleKeyFromChassis(chassis);
  const last3 = chassis.replace(/[^0-9]/g, "").slice(-3) || null;
  const v = await prisma.pitVehicle.upsert({
    where: { vehicleKey },
    create: {
      vehicleKey,
      chassisLast3: last3,
      vehicleName: opts.vehicleName ?? null,
      modelCode,
      inspectionExpiry: expiry,
    },
    update: {
      // 新しい情報が来たら埋める（空欄のみ更新・上書きはしない）
      ...(opts.vehicleName ? { vehicleName: { set: opts.vehicleName } } : {}),
      ...(expiry ? { inspectionExpiry: { set: expiry } } : {}),
      ...(modelCode ? { modelCode: { set: modelCode } } : {}),
    },
    select: { id: true, vehicleKey: true },
  });
  return v;
}

// 施工証明書のハッシュ: 記録の内容＋写真バイナリから決定的に計算する。
// 記録が1バイトでも改ざんされるとハッシュが変わる＝URLに埋めた発行時ハッシュと不一致になる。
export function certHash(record: {
  postId: string;
  vehicleName: string;
  chassisLast3: string | null;
  category: string;
  title: string | null;
  memo: string | null;
  storeName: string;
  workedAt: string; // ISO日付
  photos: Buffer[];
}): string {
  const h = createHash("sha256");
  h.update(
    JSON.stringify({
      v: 1,
      postId: record.postId,
      vehicleName: record.vehicleName,
      chassisLast3: record.chassisLast3,
      category: record.category,
      title: record.title,
      memo: record.memo,
      storeName: record.storeName,
      workedAt: record.workedAt,
      external_proof: null, // 将来の外部証明基盤（Ledra等）連携スロット
    }),
  );
  for (const p of record.photos) h.update(new Uint8Array(p));
  return h.digest("hex");
}
