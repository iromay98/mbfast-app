"use client";

import { useActionState } from "react";
import { Button, Card, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import { emptyFormState, type FormState } from "@/lib/actions/form-state";
import { announcementCategoryLabels } from "@/lib/labels";

export function AnnouncementForm({
  action,
  defaults,
  submitLabel,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  defaults?: { title?: string; body?: string; category?: "NOTICE" | "TECH" | "PRICING" };
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, emptyFormState);
  const fe = state.fieldErrors ?? {};

  return (
    <Card>
      <form action={formAction} className="space-y-4">
        <Field label="タイトル *" hint={fe.title}>
          <Input name="title" defaultValue={defaults?.title ?? ""} required />
        </Field>
        <Field label="カテゴリ *">
          <Select name="category" defaultValue={defaults?.category ?? "NOTICE"}>
            {Object.entries(announcementCategoryLabels).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="本文（Markdown 可） *" hint={fe.body}>
          <Textarea name="body" rows={10} defaultValue={defaults?.body ?? ""} required />
        </Field>

        <FormError message={state.error} />
        {state.ok && (
          <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">保存しました。</p>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? "保存中…" : submitLabel}
        </Button>
      </form>
    </Card>
  );
}
