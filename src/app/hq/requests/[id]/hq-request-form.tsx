"use client";

import { useActionState, useState } from "react";
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
  requestedLabel = null,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  currentStatus: keyof typeof requestStatusLabels;
  currentHqNote: string | null;
  currentServiceRecordId: string | null;
  recordOptions: RecordOption[];
  hasResultFile: boolean;
  // リクエスト内容（「…」から抽出したラベル）。自動登録の対象表示用。
  requestedLabel?: string | null;
}) {
  const [state, formAction, pending] = useActionState(action, emptyFormState);
  const fe = state.fieldErrors ?? {};
  const [specMatch, setSpecMatch] = useState<"as_requested" | "different">("as_requested");
  const autoMessage = (state.data as { autoMessage?: string } | undefined)?.autoMessage;

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

        {/* 納品内容: リクエスト通りなら納品と同時にバリエーションへ自動登録される */}
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-ink-soft">納品内容</div>
          <div className="flex flex-col gap-1.5 text-sm">
            <label className="inline-flex items-start gap-2">
              <input
                type="radio"
                name="specMatch"
                value="as_requested"
                checked={specMatch === "as_requested"}
                onChange={() => setSpecMatch("as_requested")}
                className="mt-0.5 h-4 w-4 accent-gold-500"
              />
              <span>
                リクエスト通りの内容
                {requestedLabel && (
                  <span className="ml-1 rounded bg-gold-50 px-1.5 py-0.5 text-xs font-semibold text-gold-700">
                    {requestedLabel}
                  </span>
                )}
                <span className="block text-xs text-ink-soft">
                  納品と同時にバリエーションへ自動登録されます（配布可）。再アップ不要。
                </span>
              </span>
            </label>
            <label className="inline-flex items-start gap-2">
              <input
                type="radio"
                name="specMatch"
                value="different"
                checked={specMatch === "different"}
                onChange={() => setSpecMatch("different")}
                className="mt-0.5 h-4 w-4 accent-sky-500"
              />
              <span>
                リクエストと異なる仕様
                <span className="block text-xs text-ink-soft">
                  バリエーションへは自動登録しません。備考を残せます。
                </span>
              </span>
            </label>
          </div>
          {specMatch === "different" && (
            <input
              type="text"
              name="specNote"
              placeholder="備考（例: 現車に合わせて弱め・Stage1.5相当）※本店コメントに追記されます"
              className="block w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
            />
          )}
        </div>

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
            {autoMessage && <span className="block text-xs">{autoMessage}</span>}
          </p>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? "更新中…" : "更新する"}
        </Button>
      </form>
    </Card>
  );
}
