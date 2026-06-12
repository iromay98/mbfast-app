"use client";

import { useActionState } from "react";
import { Button, Card, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import { emptyFormState, type FormState } from "@/lib/actions/form-state";

type DealerDefaults = {
  name?: string;
  address?: string | null;
  lat?: number | null;
  lng?: number | null;
  phone?: string | null;
  email?: string | null;
  autotunerToolId?: string | null;
  note?: string | null;
  status?: "ACTIVE" | "INACTIVE";
};

export function DealerForm({
  action,
  defaults,
  submitLabel,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  defaults?: DealerDefaults;
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(action, emptyFormState);
  const fe = state.fieldErrors ?? {};

  return (
    <Card>
      <form action={formAction} className="space-y-4">
        <Field label="店名 *" hint={fe.name}>
          <Input name="name" defaultValue={defaults?.name ?? ""} required />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="メールアドレス" hint={fe.email}>
            <Input
              type="email"
              name="email"
              inputMode="email"
              defaultValue={defaults?.email ?? ""}
            />
          </Field>
          <Field label="電話番号">
            <Input name="phone" inputMode="tel" defaultValue={defaults?.phone ?? ""} />
          </Field>
        </div>

        <Field label="住所">
          <Input name="address" defaultValue={defaults?.address ?? ""} />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="緯度 (lat)" hint={fe.lat}>
            <Input
              name="lat"
              inputMode="decimal"
              placeholder="35.6271"
              defaultValue={defaults?.lat ?? ""}
            />
          </Field>
          <Field label="経度 (lng)" hint={fe.lng}>
            <Input
              name="lng"
              inputMode="decimal"
              placeholder="139.6498"
              defaultValue={defaults?.lng ?? ""}
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="スレーブツールID等のメモ">
            <Input
              name="autotunerToolId"
              defaultValue={defaults?.autotunerToolId ?? ""}
            />
          </Field>
          <Field label="ステータス">
            <Select name="status" defaultValue={defaults?.status ?? "ACTIVE"}>
              <option value="ACTIVE">有効</option>
              <option value="INACTIVE">無効</option>
            </Select>
          </Field>
        </div>

        <Field label="備考">
          <Textarea name="note" rows={3} defaultValue={defaults?.note ?? ""} />
        </Field>

        <FormError message={state.error} />
        {state.ok && (
          <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
            保存しました。
          </p>
        )}

        <Button type="submit" disabled={pending}>
          {pending ? "保存中…" : submitLabel}
        </Button>
      </form>
    </Card>
  );
}
