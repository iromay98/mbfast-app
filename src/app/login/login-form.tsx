"use client";

import { useActionState, useEffect } from "react";
import { authenticate } from "@/lib/actions/auth";
import { Button, Card, Field, FormError, Input } from "@/components/ui";

export function LoginForm() {
  const [state, formAction, isPending] = useActionState(authenticate, undefined);

  // 認証成功（Cookie確定済み）→ 全画面遷移。proxy がロールに応じて /hq or /dealer へ振り分ける。
  useEffect(() => {
    if (state?.ok) window.location.href = "/";
  }, [state]);

  const errorMessage = state?.error;
  const loggingIn = isPending || state?.ok;

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
        <Button type="submit" className="w-full" disabled={loggingIn}>
          {loggingIn ? "ログイン中…" : "ログイン"}
        </Button>
      </form>
    </Card>
  );
}
