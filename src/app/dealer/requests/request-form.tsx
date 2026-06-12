"use client";

import { useActionState } from "react";
import { Button, Card, Field, FormError, Input, Textarea } from "@/components/ui";
import { emptyFormState } from "@/lib/actions/form-state";
import { createFileRequest } from "@/lib/actions/requests";

export function RequestForm() {
  const [state, formAction, pending] = useActionState(
    createFileRequest,
    emptyFormState,
  );
  const fe = state.fieldErrors ?? {};

  return (
    <Card>
      <form action={formAction} className="space-y-4">
        <Field label="タイトル *" hint={fe.title}>
          <Input name="title" placeholder="例: Audi RS3 8V Stage1 依頼" required />
        </Field>

        <Field label="車両情報（自由記述）">
          <Input name="carInfo" placeholder="Audi RS3 8V / 2019 / DAZA" />
        </Field>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="車台番号(VIN)">
            <Input name="vin" className="font-mono" autoCapitalize="characters" />
          </Field>
          <Field label="ECU型式">
            <Input name="ecuType" placeholder="Bosch MG1" />
          </Field>
        </div>

        <Field label="依頼内容">
          <Textarea name="requestNote" rows={4} placeholder="希望マップ・装着パーツ・備考など" />
        </Field>

        <Field
          label="スレーブ/読み出しファイル（任意）"
          hint={fe.inputFile ?? "ECUファイル等。上限50MB。"}
        >
          <input
            type="file"
            name="inputFile"
            className="block w-full text-sm text-ink file:mr-3 file:min-h-11 file:rounded-lg file:border-0 file:bg-gold-500 file:px-4 file:text-sm file:font-semibold file:text-white"
          />
        </Field>

        <FormError message={state.error} />
        <Button type="submit" disabled={pending}>
          {pending ? "送信中…" : "本店へ依頼する"}
        </Button>
      </form>
    </Card>
  );
}
