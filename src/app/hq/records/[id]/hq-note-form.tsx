"use client";

import { useActionState } from "react";
import { Button, Card, FormError, Textarea } from "@/components/ui";
import { emptyFormState, type FormState } from "@/lib/actions/form-state";

export function HqNoteForm({
  action,
  defaultValue,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  defaultValue: string;
}) {
  const [state, formAction, pending] = useActionState(action, emptyFormState);

  return (
    <Card className="border-gold-200 bg-gold-50">
      <h3 className="mb-1 text-sm font-bold text-ink">本店メモ（本店のみ・代理店非公開）</h3>
      <p className="mb-2 text-xs text-ink-soft">
        Driver名やキャリブレーション、社内の備考など、本店だけが見られるメモです。
      </p>
      <form action={formAction} className="space-y-2">
        <Textarea name="hqNote" rows={4} defaultValue={defaultValue} placeholder="例: AQ3_C4AD / st1(DC) / 顧客メモ など" />
        <FormError message={state.error} />
        {state.ok && (
          <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">保存しました。</p>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? "保存中…" : "本店メモを保存"}
        </Button>
      </form>
    </Card>
  );
}
