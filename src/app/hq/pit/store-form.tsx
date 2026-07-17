"use client";

import { useActionState, useState } from "react";
import { Button, Field, FormError, Input, Select, Textarea } from "@/components/ui";
import { emptyFormState } from "@/lib/actions/form-state";
import { upsertPitStore } from "@/lib/actions/pit";
import type { PitStorePreset } from "@/server/pit/presets";

type StoreDefaults = {
  dealerId: string;
  displayName?: string;
  wpCategoryId?: number;
  storeSlug?: string;
  footerHtml?: string;
  active?: boolean;
};

/**
 * mbPIT 店舗設定フォーム（新規登録・編集共用）。
 * 新規時は初期5店のプリセット（カテゴリID確定済み）から選んで一括入力できる。
 */
export function PitStoreForm({
  dealers,
  defaults,
  presets,
  submitLabel,
}: {
  dealers: { id: string; name: string }[]; // 新規: 未設定の代理店一覧 / 編集: 対象1件
  defaults?: StoreDefaults;
  presets?: PitStorePreset[];
  submitLabel: string;
}) {
  const [state, formAction, pending] = useActionState(upsertPitStore, emptyFormState);
  const fe = state.fieldErrors ?? {};
  const [preset, setPreset] = useState<PitStorePreset | null>(null);
  const isEdit = !!defaults;

  return (
    <form action={formAction} className="space-y-3">
      {isEdit ? (
        <input type="hidden" name="dealerId" value={defaults.dealerId} />
      ) : (
        <Field label="店舗（代理店アカウント）*" hint={fe.dealerId}>
          <Select name="dealerId" required defaultValue="">
            <option value="" disabled>
              選択してください
            </option>
            {dealers.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </Field>
      )}

      {!isEdit && presets && presets.length > 0 && (
        <Field label="プリセット（初期5店・カテゴリID確定済み）">
          <Select
            value={preset ? preset.displayName : ""}
            onChange={(e) => {
              const p = presets.find((x) => x.displayName === e.target.value) ?? null;
              setPreset(p);
            }}
          >
            <option value="">（手入力）</option>
            {presets.map((p) => (
              <option key={p.displayName} value={p.displayName}>
                {p.displayName}（ID {p.wpCategoryId} / {p.storeSlug}）
              </option>
            ))}
          </Select>
        </Field>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="表示名 *" hint={fe.displayName}>
          <Input
            key={`dn-${preset?.displayName ?? "manual"}`}
            name="displayName"
            required
            defaultValue={preset?.displayName ?? defaults?.displayName ?? ""}
          />
        </Field>
        <Field label="WPカテゴリID *" hint={fe.wpCategoryId}>
          <Input
            key={`ci-${preset?.displayName ?? "manual"}`}
            name="wpCategoryId"
            required
            inputMode="numeric"
            defaultValue={preset?.wpCategoryId ?? defaults?.wpCategoryId ?? ""}
          />
        </Field>
        <Field label="店舗slug *" hint={fe.storeSlug ?? "記事slug末尾に入ります"}>
          <Input
            key={`sl-${preset?.displayName ?? "manual"}`}
            name="storeSlug"
            required
            defaultValue={preset?.storeSlug ?? defaults?.storeSlug ?? ""}
          />
        </Field>
      </div>

      <Field
        label="フッターHTML（店舗紹介＋問い合わせCTA）"
        hint="記事末尾に自動結合されます。住所・営業時間・問い合わせ導線を含めてください"
      >
        <Textarea
          name="footerHtml"
          rows={5}
          defaultValue={defaults?.footerHtml ?? ""}
          placeholder='<div class="store-footer">…</div>'
        />
      </Field>

      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" name="active" defaultChecked={defaults?.active ?? true} />
        投稿を有効にする
      </label>

      <FormError message={state.error} />
      {state.ok && <p className="text-sm text-green-700">保存しました</p>}

      <Button type="submit" disabled={pending}>
        {pending ? "保存中…" : submitLabel}
      </Button>
    </form>
  );
}
