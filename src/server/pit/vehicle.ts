// 車両（車のお薬手帳）: 車検証QRの車台番号 → vehicle_key 変換と、QRペイロードの寛容パース。
//
// セキュリティ方針:
//  - 車台番号の平文はDBに保存しない。保存するのは HMAC-SHA256(車台番号, SERVER_SECRET) と下3桁のみ
//  - SERVER_SECRET を知らない第三者は車台番号から vehicleKey を導出できない
//  - SERVER_SECRET は一度発行したら変更しないこと（変更すると既存車両に紐づけ直せなくなる）

import { createHash, createHmac } from "node:crypto";
import { prisma } from "@/lib/db";
import { normalizeChassis } from "@/server/pit/chassis";
import { parseShakenQr } from "@/server/pit/shaken-qr";

export function vehicleFeatureEnabled(): boolean {
  return !!process.env.SERVER_SECRET;
}

// 正規化はDB非依存の chassis.ts が原本（読み取り側と同じ関数を使う）
export { normalizeChassis };

export function vehicleKeyFromChassis(chassis: string): string {
  const secret = process.env.SERVER_SECRET;
  if (!secret) throw new Error("SERVER_SECRET が未設定です");
  return createHmac("sha256", secret).update(normalizeChassis(chassis)).digest("hex");
}

// 車検証QRの解析はDB非依存の shaken-qr.ts が原本（カメラのスキャナからも同じ関数を使う）
export { parseShakenQr, chassisFromQrText, type ParsedShakenQr } from "@/server/pit/shaken-qr";

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
