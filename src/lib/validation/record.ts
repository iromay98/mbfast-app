import { z } from "zod";

const optionalStr = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

// 車検証スキャンの生データ(JSON文字列)を受け取りオブジェクト化。失敗時は undefined。
const optionalJson = z
  .string()
  .optional()
  .transform((v) => {
    if (!v) return undefined;
    try {
      return JSON.parse(v) as unknown;
    } catch {
      return undefined;
    }
  });

// 電子車検証 二次元コードから取得する車両情報（すべて任意・新規/補足で共通）
const shakenFields = {
  registrationNumber: optionalStr,
  vehicleModelCode: optionalStr,
  engineModelCode: optionalStr,
  modelDesignationNumber: optionalStr,
  firstRegistration: optionalStr,
  inspectionExpiry: optionalStr,
  shakenScanRaw: optionalJson,
};

export const serviceRecordSchema = z.object({
  vin: z.string().trim().min(1, "車台番号(VIN)は必須です"),
  carMaker: z.string().trim().min(1, "メーカーは必須です"),
  carModel: z.string().trim().min(1, "車種は必須です"),
  carYear: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === "" || v === null) return undefined;
      const n = typeof v === "number" ? v : parseInt(String(v), 10);
      return Number.isFinite(n) ? n : undefined;
    }),
  ecuType: optionalStr, // 代理店フォームからは撤去（専門項目）。任意。
  tcuType: optionalStr,
  softwareNumber: optionalStr,
  customerName: optionalStr,
  workType: z.enum(["TUNING", "POPS_AND_BANGS", "TCU", "OTHER"]),
  appliedMap: optionalStr,
  ...shakenFields,
  workedAt: z
    .string()
    .min(1, "施工日は必須です")
    .transform((v) => new Date(v))
    .refine((d) => !Number.isNaN(d.getTime()), "施工日の形式が正しくありません"),
  note: optionalStr,
});

export type ServiceRecordInput = z.infer<typeof serviceRecordSchema>;

// 代理店が後から補う項目（スレーブ自動生成レコードの補足）。すべて任意。
export const recordSupplementSchema = z.object({
  vin: optionalStr,
  workType: z
    .union([z.literal(""), z.enum(["TUNING", "POPS_AND_BANGS", "TCU", "OTHER"])])
    .optional()
    .transform((v) => (v ? v : undefined)),
  softwareNumber: optionalStr,
  appliedMap: optionalStr,
  tcuType: optionalStr,
  hwNumber: optionalStr,
  swNumber: optionalStr,
  calNumber: optionalStr,
  customerName: optionalStr,
  carYear: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => {
      if (v === undefined || v === "" || v === null) return undefined;
      const n = typeof v === "number" ? v : parseInt(String(v), 10);
      return Number.isFinite(n) ? n : undefined;
    }),
  ...shakenFields,
  note: optionalStr,
});
