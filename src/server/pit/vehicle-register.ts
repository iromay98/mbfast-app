/*
 * 車両の登録（証明書・法定記録簿のための非公開項目つき）。
 *
 * vehicle.ts（HMACと公開項目のみ）とは意図的に分けている。
 * 公開ブログ生成の経路（generate.ts / pipeline.ts / vehicle.ts）から
 * 個人情報の暗号モジュールへ辿れないようにするため、暗号化を扱うのはこのファイルだけ。
 *
 * 保存するもの:
 *  - vehicleKey  … HMAC-SHA256(車台番号, SERVER_SECRET)。車両の一意キー（従来どおり）
 *  - chassisLast3… 表示・簡易照合用の下3桁（既存の平文断片。新たな断片は増やさない）
 *  - vinEnc / regNumberEnc … AES-256-GCM（キーID付き）。復号は監査ログ必須の経路のみ
 */
import { prisma } from "@/lib/db";
import { normalizeChassis, vehicleFeatureEnabled, vehicleKeyFromChassis } from "@/server/pit/vehicle";
import { decryptPiiAudited, encryptPii, keyIdOf, needsRekey, piiCryptoConfigured } from "@/server/pit/pii-crypto";

export type VehicleRegisterInput = {
  /** 車台番号（平文。ここから出さない） */
  vin: string;
  /** 登録番号＝ナンバー（非公開） */
  registrationNumber?: string;
  /** 車種表示（公開可。例: アルファード 30系） */
  vehicleName?: string;
  /** メーカー（車検証の「車名」欄。公開可） */
  maker?: string;
  modelCode?: string;
  /** 初度登録年月（公開は年月まで） */
  firstRegisteredOn?: Date | null;
  /** 有効期間の満了する日 */
  inspectionExpiry?: Date | null;
};

export type RegisteredVehicle = {
  id: string;
  vehicleKey: string;
  chassisLast3: string;
  created: boolean;
};

/** 証明書機能に必要な設定が揃っているか（鍵が無ければ車両登録をさせない） */
export function vehicleRegistrationReady(): { ok: boolean; error?: string } {
  if (!vehicleFeatureEnabled()) return { ok: false, error: "車両機能が未設定です（本部にお問い合わせください）" };
  if (!piiCryptoConfigured()) {
    return { ok: false, error: "証明書の暗号鍵が未設定のため車両を登録できません（本部にお問い合わせください）" };
  }
  return { ok: true };
}

/**
 * 車台番号をキーに車両を作成／更新する。
 * 既存の値は上書きせず空欄だけ埋める（他店が入れた情報を壊さない）。
 * ただし暗号化済み項目は、未設定または旧鍵のときだけ書き換える。
 */
export async function registerVehicle(
  input: VehicleRegisterInput,
): Promise<{ vehicle?: RegisteredVehicle; error?: string }> {
  const ready = vehicleRegistrationReady();
  if (!ready.ok) return { error: ready.error };

  const vin = normalizeChassis(input.vin);
  if (vin.length < 6) return { error: "車台番号が短すぎます。車検証を見て入力してください" };
  const vehicleKey = vehicleKeyFromChassis(vin);
  const last3 = vin.replace(/[^0-9]/g, "").slice(-3);
  const reg = (input.registrationNumber ?? "").trim();

  const existing = await prisma.pitVehicle.findUnique({
    where: { vehicleKey },
    select: { id: true, vinEnc: true, regNumberEnc: true },
  });

  const fill = {
    ...(input.vehicleName?.trim() ? { vehicleName: input.vehicleName.trim() } : {}),
    ...(input.maker?.trim() ? { maker: input.maker.trim() } : {}),
    ...(input.modelCode?.trim() ? { modelCode: normalizeChassis(input.modelCode) } : {}),
    ...(input.firstRegisteredOn ? { firstRegisteredOn: input.firstRegisteredOn } : {}),
    ...(input.inspectionExpiry ? { inspectionExpiry: input.inspectionExpiry } : {}),
  };

  if (!existing) {
    const v = await prisma.pitVehicle.create({
      data: {
        vehicleKey,
        chassisLast3: last3 || null,
        vinEnc: encryptPii(vin),
        ...(reg ? { regNumberEnc: encryptPii(reg) } : {}),
        ...fill,
      },
      select: { id: true },
    });
    return { vehicle: { id: v.id, vehicleKey, chassisLast3: last3, created: true } };
  }

  // 暗号文の入れ替えは「無い」「旧鍵」のときだけ（無用な書き換えで監査を濁さない）
  const vinEnc = !existing.vinEnc || needsRekey(existing.vinEnc) ? encryptPii(vin) : undefined;
  const regEnc = reg && (!existing.regNumberEnc || needsRekey(existing.regNumberEnc)) ? encryptPii(reg) : undefined;

  await prisma.pitVehicle.update({
    where: { id: existing.id },
    data: {
      ...(last3 ? { chassisLast3: last3 } : {}),
      ...(vinEnc ? { vinEnc } : {}),
      ...(regEnc ? { regNumberEnc: regEnc } : {}),
      ...fill,
    },
  });
  return { vehicle: { id: existing.id, vehicleKey, chassisLast3: last3, created: false } };
}

/** 車台番号から既存車両を引く（登録せずに照会したいとき） */
export async function findVehicleByVin(vin: string): Promise<{ id: string; chassisLast3: string | null } | null> {
  if (!vehicleFeatureEnabled()) return null;
  const normalized = normalizeChassis(vin);
  if (normalized.length < 6) return null;
  return prisma.pitVehicle.findUnique({
    where: { vehicleKey: vehicleKeyFromChassis(normalized) },
    select: { id: true, chassisLast3: true },
  });
}

/**
 * 証明書・法定記録簿に載せるための復号（監査ログ必須）。
 * 復号モジュールを import できるのはこのファイルだけという制約を保つため、
 * 「読む」経路もここに置く（scripts/check-cert-privacy.mts が import 元を検査している）。
 *
 * 誰が読んだか分からない復号を作らないよう、呼び出し側は必ず文脈を渡す。
 * 共有リンク（ログイン不要）からの閲覧も actorRole="share" として記録する。
 */
export async function readVehicleSecrets(
  vehicleId: string,
  ctx: { actorUserId: string; actorRole: string; purpose: string; certificateId?: string | null },
): Promise<{ vin: string | null; registrationNumber: string | null }> {
  const v = await prisma.pitVehicle.findUnique({
    where: { id: vehicleId },
    select: { vinEnc: true, regNumberEnc: true },
  });
  if (!v) return { vin: null, registrationNumber: null };
  const base = { ...ctx, vehicleId, certificateId: ctx.certificateId ?? null };
  const [vin, registrationNumber] = await Promise.all([
    decryptPiiAudited(v.vinEnc, { ...base, field: "vin" }),
    decryptPiiAudited(v.regNumberEnc, { ...base, field: "regNumber" }),
  ]);
  return { vin, registrationNumber };
}

/** 暗号化状況の把握（鍵ローテーションの残件確認用。値そのものは返さない） */
export function encryptionStatusOf(v: { vinEnc: string | null; regNumberEnc: string | null }): {
  hasVin: boolean;
  hasRegNumber: boolean;
  keyId: string | null;
  needsRekey: boolean;
} {
  return {
    hasVin: !!v.vinEnc,
    hasRegNumber: !!v.regNumberEnc,
    keyId: keyIdOf(v.vinEnc),
    needsRekey: needsRekey(v.vinEnc) || needsRekey(v.regNumberEnc),
  };
}
