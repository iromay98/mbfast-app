"use client";

import { useActionState } from "react";
import { Button, Field, FormError, Input } from "@/components/ui";
import { emptyFormState } from "@/lib/actions/form-state";
import { issueDealerAccount } from "@/lib/actions/dealers";

export function AccountIssuer({ dealerId }: { dealerId: string }) {
  const [state, formAction, pending] = useActionState(
    issueDealerAccount,
    emptyFormState,
  );
  const fe = state.fieldErrors ?? {};
  const issued = state.ok && state.data;

  return (
    <div className="space-y-3">
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="dealerId" value={dealerId} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="担当者名 *" hint={fe.name}>
            <Input name="name" required />
          </Field>
          <Field label="ログイン用メール *" hint={fe.email}>
            <Input type="email" name="email" inputMode="email" required />
          </Field>
        </div>
        <FormError message={state.error} />
        <Button type="submit" variant="secondary" disabled={pending}>
          {pending ? "発行中…" : "アカウントを発行"}
        </Button>
      </form>

      {issued && (
        <div className="rounded-lg border border-gold-200 bg-gold-50 p-3">
          <p className="text-sm font-medium text-ink">
            アカウントを発行しました。初期パスワードは
            <span className="text-gold-700">この画面でのみ表示</span>されます。
          </p>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-ink-soft">メール</dt>
            <dd className="font-mono">{String(state.data?.email)}</dd>
            <dt className="text-ink-soft">初期パスワード</dt>
            <dd className="font-mono font-bold">{String(state.data?.password)}</dd>
          </dl>
          <p className="mt-2 text-xs text-ink-soft">
            代理店へ安全な方法で共有し、初回ログイン後の変更を案内してください。
          </p>
        </div>
      )}
    </div>
  );
}
