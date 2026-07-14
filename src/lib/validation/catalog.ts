import { z } from "zod";

const optionalStr = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

const optionalBool = z
  .union([z.boolean(), z.string()])
  .optional()
  .transform((v) => {
    if (v === undefined) return undefined;
    if (typeof v === "boolean") return v;
    return v === "true" || v === "on" || v === "1";
  });

export const variantStatusEnum = z.enum(["DRAFT", "AVAILABLE", "DISABLED"]);

// BaseFile（ストック識別）作成・更新
export const baseFileSchema = z.object({
  manufacturer: z.string().trim().min(1, "メーカーは必須です"),
  model: z.string().trim().min(1, "車種は必須です"),
  ecu: z.string().trim().min(1, "ECUは必須です"),
  mcu: optionalStr,
  note: optionalStr,
  driver: optionalStr,
  generation: optionalStr,
  grade: optionalStr,
  driverBorrowed: optionalBool,
  // 自動認識しなかった時に本店が手入力する ECU 識別子
  hwNumber: optionalStr,
  swNumber: optionalStr,
  calNumber: optionalStr,
  stockHash: optionalStr,
  // スピードリミッターカット不可（この純正＝Calでは作れない）
  limiterCutDisabled: optionalBool,
  // 対象ユニット "ECU" | "TCU"
  unit: optionalStr,
  // 読み取りツール（AT/PG3/K3/任意）と読み方式（OBD/Bench/Boot/任意）
  tool: optionalStr,
  method: optionalStr,
  // 準用グループキー（同一キャリブレーション・別ツール準用）
  substituteKey: optionalStr,
});

export const baseFilePatchSchema = baseFileSchema.partial();

// TunedVariant 作成（既存 base 指定 or 新規 base 作成）
export const variantCreateSchema = z.object({
  baseFileId: optionalStr,
  manufacturer: optionalStr,
  model: optionalStr,
  ecu: optionalStr,
  mcu: optionalStr,
  stockHash: optionalStr,
  stage: optionalStr,
  popsAndBangs: optionalBool,
  popsSport: optionalBool,
  options: optionalStr,
  note: optionalStr,
});

// インライン編集パッチ（送られたキーのみ反映）。空文字はクリアとして扱う。
export const variantPatchSchema = z.object({
  stage: z.string().trim().optional(),
  popsAndBangs: optionalBool,
  optionTags: z.array(z.string().trim()).optional(),
  options: z.string().trim().optional(),
  note: z.string().trim().optional(),
  status: variantStatusEnum.optional(),
  manufacturer: z.string().trim().optional(),
  model: z.string().trim().optional(),
  ecu: z.string().trim().optional(),
  mcu: z.string().trim().optional(),
});

export type VariantPatch = z.infer<typeof variantPatchSchema>;
