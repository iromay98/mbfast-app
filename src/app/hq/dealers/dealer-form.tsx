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
  fileFormat?: string | null;
  ecuEnabled?: boolean;
  // 契約（1年更新）。日付は "YYYY-MM-DD"（input[type=date] の値）
  contractStartedAt?: string;
  contractEndedAt?: string;
  contractRenewalMonths?: number;
  contractNoticeDays?: number;
  contractNote?: string | null;
  /** 現在の契約状況の説明（次回更新日・残り日数）。フォーム下に出す */
  contractSummary?: string;
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

        <Field
          label="やり取りファイル形式"
          hint="Powergate3(OBLY/Rig Tuning等)は Master File。通常の代理店はスレーブ。"
        >
          <Select name="fileFormat" defaultValue={defaults?.fileFormat ?? "SLAVE"}>
            <option value="SLAVE">スレーブ（AutoTuner）</option>
            <option value="MASTER">Master File（Powergate3・生bin）</option>
          </Select>
        </Field>

        <Field
          label="ECU業務"
          hint="ONで「施工依頼・記録」を表示。コーティング等の別業種の代理店はOFFにすると非表示になります（既定ON）。"
        >
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              name="ecuEnabled"
              defaultChecked={defaults?.ecuEnabled ?? true}
              className="h-4 w-4"
            />
            この代理店はECU業務あり（施工依頼・記録を表示）
          </label>
        </Field>

        {/*
          契約（1年更新）。次回更新日はDBに持たず開始日から計算する（src/lib/contract.ts）。
          「見直しの何日前から知らせるか」を持つのは、条件変更の申し出に猶予が要るため。
        */}
        <fieldset className="rounded-lg border border-line p-3">
          <legend className="px-1 text-xs font-semibold text-ink-soft">契約（1年更新）</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="契約開始日" hint="ここから毎年の応当日が更新日になります">
              <Input type="date" name="contractStartedAt" defaultValue={defaults?.contractStartedAt ?? ""} />
            </Field>
            <Field label="更新周期（月）" hint="既定12＝1年更新。半年なら6、2年なら24">
              <Input
                name="contractRenewalMonths"
                inputMode="numeric"
                defaultValue={defaults?.contractRenewalMonths ?? 12}
              />
            </Field>
            <Field label="見直しの通知（更新の何日前から）" hint="既定60日。一覧で「見直し時期」として出ます">
              <Input
                name="contractNoticeDays"
                inputMode="numeric"
                defaultValue={defaults?.contractNoticeDays ?? 60}
              />
            </Field>
            <Field label="解約日" hint="入れると更新の催促を止めます（空欄=継続中）">
              <Input type="date" name="contractEndedAt" defaultValue={defaults?.contractEndedAt ?? ""} />
            </Field>
          </div>
          <div className="mt-3">
            <Field label="契約条件のメモ（本部専用・代理店には見せません）">
              <Textarea name="contractNote" rows={3} defaultValue={defaults?.contractNote ?? ""} />
            </Field>
          </div>
          {defaults?.contractSummary && (
            <p className="mt-2 rounded-lg bg-surface-2 px-3 py-2 text-xs text-ink">{defaults.contractSummary}</p>
          )}
        </fieldset>

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
