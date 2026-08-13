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

/*
 * input[type=date]（"YYYY-MM-DD"）→ Date。空文字は null（=未登録/解除）にする。
 * undefined ではなく null を返すのは、一度入れた日付を空にして消せるようにするため
 * （undefined だと Prisma が「変更しない」と解釈して消せない）。
 * JSTの日付として扱うため 00:00Z 固定で作る（表示側も contract.ts でJST基準に揃える）。
 */
const optionalDate = z
  .string()
  .trim()
  .optional()
  .transform((v) => {
    if (!v) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(v);
    if (!m) return null;
    return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
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
  // ECU業務を行う代理店か（施工依頼・記録の特殊機能を出すか）。
  // チェックボックス: on=true / 未チェックで欠落=false。フォームは常にこの項目を出す前提。
  ecuEnabled: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),

  // ── 契約（1年更新）。次回更新日は保存せず contract.ts が開始日から計算する ──
  contractStartedAt: optionalDate,
  contractEndedAt: optionalDate,
  contractRenewalMonths: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => {
      const n = typeof v === "number" ? v : Number(v ?? "");
      return Number.isInteger(n) && n > 0 && n <= 120 ? n : 12; // 既定1年更新
    }),
  contractNoticeDays: z
    .union([z.string(), z.number()])
    .optional()
    .transform((v) => {
      const n = typeof v === "number" ? v : Number(v ?? "");
      return Number.isInteger(n) && n >= 0 && n <= 365 ? n : 60; // 既定60日前から
    }),
  contractNote: optionalStr,
});

export type DealerInput = z.infer<typeof dealerSchema>;

// 代理店アカウント発行
export const dealerAccountSchema = z.object({
  dealerId: z.string().min(1),
  name: z.string().trim().min(1, "担当者名は必須です"),
  email: z.string().trim().email("メールアドレスの形式が正しくありません"),
});
