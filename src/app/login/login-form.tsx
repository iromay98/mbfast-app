"use client";

import { useActionState } from "react";
import { authenticate } from "@/lib/actions/auth";
import { Button, Card, Field, FormError, Input } from "@/components/ui";

export function LoginForm() {
  const [errorMessage, formAction, isPending] = useActionState(
    authenticate,
    undefined,
  );

  return (
    <Card>
      <form action={formAction} className="space-y-4">
        <Field label="メールアドレス">
          <Input
            type="email"
            name="email"
            autoComplete="username"
            inputMode="email"
            placeholder="you@mbfast.jp"
            required
          />
        </Field>
        <Field label="パスワード">
          <Input
            type="password"
            name="password"
            autoComplete="current-password"
            placeholder="••••••••"
            required
          />
        </Field>
        <FormError message={errorMessage} />
        <Button type="submit" className="w-full" disabled={isPending}>
          {isPending ? "ログイン中…" : "ログイン"}
        </Button>
      </form>
    </Card>
  );
}
