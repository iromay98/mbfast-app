"use client";

import { useActionState } from "react";
import { changePassword } from "@/lib/actions/auth";
import { Button, Card, Field, FormError, Input } from "@/components/ui";

export function ChangePasswordForm() {
  const [state, formAction, pending] = useActionState(changePassword, undefined);

  return (
    <Card>
      {state?.ok ? (
        <p className="rounded-lg bg-green-50 px-3 py-3 text-sm font-semibold text-green-700">
          ✅ パスワードを変更しました。次回のログインから新しいパスワードを使ってください。
        </p>
      ) : (
        <form action={formAction} className="space-y-4">
          <Field label="現在のパスワード">
            <Input type="password" name="current" autoComplete="current-password" required />
          </Field>
          <Field label="新しいパスワード（8文字以上）">
            <Input type="password" name="next" autoComplete="new-password" minLength={8} required />
          </Field>
          <Field label="新しいパスワード（確認）">
            <Input type="password" name="confirm" autoComplete="new-password" minLength={8} required />
          </Field>
          <FormError message={state?.error} />
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? "変更中…" : "パスワードを変更"}
          </Button>
        </form>
      )}
    </Card>
  );
}
