import { z } from "zod";

// 空文字を undefined に正規化するヘルパ
const optionalStr = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

const optionalNum = z
  .union([z.string(), z.number()])
  .optional()
  .transform((v) => {
    if (v === undefined || v === "" || v === null) return undefined;
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) ? n : undefined;
  });

export const dealerSchema = z.object({
  name: z.string().trim().min(1, "店名は必須です"),
  address: optionalStr,
  lat: optionalNum,
  lng: optionalNum,
  phone: optionalStr,
  email: optionalStr.refine(
    (v) => v === undefined || z.string().email().safeParse(v).success,
    "メールアドレスの形式が正しくありません",
  ),
  autotunerToolId: optionalStr,
  note: optionalStr,
  status: z.enum(["ACTIVE", "INACTIVE"]).default("ACTIVE"),
  // やり取りファイル形式。SLAVE=AutoTunerスレーブ / MASTER=Powergate3のMaster File(生bin)。
  fileFormat: z.enum(["SLAVE", "MASTER"]).default("SLAVE"),
});

export type DealerInput = z.infer<typeof dealerSchema>;

// 代理店アカウント発行
export const dealerAccountSchema = z.object({
  dealerId: z.string().min(1),
  name: z.string().trim().min(1, "担当者名は必須です"),
  email: z.string().trim().email("メールアドレスの形式が正しくありません"),
});
