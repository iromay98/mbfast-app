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
  stockHash: optionalStr,
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
  driver: z.string().trim().optional(),
  driverBorrowed: optionalBool,
  status: variantStatusEnum.optional(),
  manufacturer: z.string().trim().optional(),
  model: z.string().trim().optional(),
  ecu: z.string().trim().optional(),
  mcu: z.string().trim().optional(),
});

export type VariantPatch = z.infer<typeof variantPatchSchema>;
