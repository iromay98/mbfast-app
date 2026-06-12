"use client";

import { useActionState } from "react";
import { Button, Card, Field, FormError, Select, Textarea } from "@/components/ui";
import { emptyFormState, type FormState } from "@/lib/actions/form-state";
import { requestStatusLabels } from "@/lib/labels";

type RecordOption = { id: string; label: string };

export function HQRequestForm({
  action,
  currentStatus,
  currentHqNote,
  currentServiceRecordId,
  recordOptions,
  hasResultFile,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  currentStatus: keyof typeof requestStatusLabels;
  currentHqNote: string | null;
  currentServiceRecordId: string | null;
  recordOptions: RecordOption[];
  hasResultFile: boolean;
}) {
  const [state, formAction, pending] = useActionState(action, emptyFormState);
  const fe = state.fieldErrors ?? {};

  return (
    <Card>
      <h3 className="mb-3 text-sm font-bold text-ink">本店処理</h3>
      <form action={formAction} className="space-y-4">
        <Field label="ステータス" hint={fe.status}>
          <Select name="status" defaultValue={currentStatus}>
            {Object.entries(requestStatusLabels).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="成果ファイル（納品ファイル）"
          hint={fe.resultFile ?? (hasResultFile ? "アップロードすると差し替えられます。" : "上限50MB。")}
        >
          <input
            type="file"
            name="resultFile"
            className="block w-full text-sm text-ink file:mr-3 file:min-h-11 file:rounded-lg file:border-0 file:bg-gold-500 file:px-4 file:text-sm file:font-semibold file:text-white"
          />
        </Field>

        <Field label="本店コメント">
          <Textarea name="hqNote" rows={3} defaultValue={currentHqNote ?? ""} />
        </Field>

        <Field label="施工記録への紐付け（任意・納品時）">
          <Select name="serviceRecordId" defaultValue={currentServiceRecordId ?? ""}>
            <option value="">紐付けなし</option>
            {recordOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>

        <FormError message={state.error} />
        {state.ok && (
          <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
            更新しました。
          </p>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? "更新中…" : "更新する"}
        </Button>
      </form>
    </Card>
  );
}
