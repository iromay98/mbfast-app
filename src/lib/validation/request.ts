import { z } from "zod";

const optionalStr = z
  .string()
  .trim()
  .optional()
  .transform((v) => (v ? v : undefined));

// 代理店による依頼作成
export const fileRequestSchema = z.object({
  title: z.string().trim().min(1, "タイトルは必須です"),
  carInfo: optionalStr,
  vin: optionalStr,
  ecuType: optionalStr,
  requestNote: optionalStr,
});

// 本店による依頼更新（ステータス変更・コメント・施工記録紐付け）
export const hqRequestUpdateSchema = z.object({
  status: z.enum(["RECEIVED", "IN_PROGRESS", "DELIVERED", "CANCELLED"]),
  hqNote: optionalStr,
  serviceRecordId: optionalStr,
});
