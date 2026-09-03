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
  uploadTools?: string[];
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
  showPitSetup = false,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  defaults?: DealerDefaults;
  submitLabel: string;
  /** 新規登録画面だけ true: mbPIT店舗の自動開設欄（slug指定・スキップ）を出す */
  showPitSetup?: boolean;
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
          label="許可するアップロード経路（複数可）"
          hint="店が持つツールに合わせてON。両方持つ店は施工記録アップ時にタブで選べます。Kess3 Slaveは復号APIが無いため本部が手動対応します。"
        >
          <div className="space-y-1.5">
            {(
              [
                ["AUTOTUNER", "AutoTuner（スレーブ・自動復号/照合）"],
                ["MASTER_BIN", "Kess3 Master等（生bin・Powergate3/KTAG含む）"],
                ["KESS3_SLAVE", "Kess3 Slave（暗号化ファイル・本部手動対応）"],
              ] as const
            ).map(([value, label]) => (
              <label key={value} className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="checkbox"
                  name="uploadTools"
                  value={value}
                  defaultChecked={
                    defaults?.uploadTools
                      ? defaults.uploadTools.includes(value)
                      : defaults?.fileFormat === "MASTER"
                        ? value === "MASTER_BIN"
                        : value === "AUTOTUNER"
                  }
                  className="h-4 w-4 accent-gold-500"
                />
                {label}
              </label>
            ))}
          </div>
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

        {showPitSetup && (
          <fieldset className="rounded-lg border border-gold-200 bg-gold-50/40 p-3">
            <legend className="px-1 text-xs font-semibold text-ink-soft">mbPIT（登録と同時に自動開設）</legend>
            <p className="mb-2 text-xs text-ink-soft">
              代理店にはmbPITの投稿機能を無償で付けます（店舗カテゴリ・店舗ページを自動作成、ジャンル初期値は「チューニング（エンジン・駆動系）」）。
            </p>
            <Field
              label="店舗slug（URL用・任意）"
              hint="英小文字・数字・ハイフン。空欄なら店名から自動生成（日本語店名は登録後に詳細画面で指定）。-mbpit 等の接尾辞は付けない"
            >
              <Input name="pitSlug" placeholder="例: charism-garage" pattern="[a-zA-Z0-9-]*" />
            </Field>
            <label className="mt-2 flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" name="pitSkip" className="h-4 w-4" />
              今回はmbPIT店舗を開設しない（後から詳細画面で開設できます）
            </label>
          </fieldset>
        )}

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
