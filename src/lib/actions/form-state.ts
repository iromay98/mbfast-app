// サーバーアクション共通のフォーム状態（useActionState 用）
export type FormState = {
  ok?: boolean;
  error?: string;
  // フィールド単位のエラー（任意）
  fieldErrors?: Record<string, string>;
  // 追加データ（例: 発行したパスワードなど）
  data?: Record<string, unknown>;
};

export const emptyFormState: FormState = {};

import { ZodError } from "zod";

/** ZodError をフィールドエラーへ変換 */
export function zodToFieldErrors(err: ZodError): Record<string, string> {
  const out: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join(".") || "_";
    if (!out[key]) out[key] = issue.message;
  }
  return out;
}
