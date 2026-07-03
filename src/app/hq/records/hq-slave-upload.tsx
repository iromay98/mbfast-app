"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, FormError } from "@/components/ui";
import { emptyFormState } from "@/lib/actions/form-state";
import { uploadSlaveRecordByHQ } from "@/lib/actions/records";

// 本部代行アップロード：代理店を指定してスレーブを登録（過去案件の取込など）
export function HQSlaveUpload({ dealers }: { dealers: { id: string; name: string }[] }) {
  const [state, formAction, pending] = useActionState(uploadSlaveRecordByHQ, emptyFormState);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      const recordId = state.data?.recordId as string | undefined;
      if (recordId) router.push(`/hq/records/${recordId}`);
      else router.refresh();
    }
  }, [state, router]);

  return (
    <Card className="mb-4 border-gold-200 bg-gold-50">
      <h2 className="text-sm font-bold text-ink">本部代行アップロード（スレーブ）</h2>
      <p className="mt-0.5 text-xs text-ink-soft">
        代理店を指定してスレーブを登録します。自動で復号・照合まで完了し、その記録から施工内容を選べます。
      </p>
      <form ref={formRef} action={formAction} className="mt-3 space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-ink-soft">代理店（必須）</span>
            <select
              name="dealerId"
              required
              defaultValue=""
              className="block w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
            >
              <option value="" disabled>
                選択してください
              </option>
              {dealers.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-ink-soft">顧客名 *</span>
            <input
              type="text"
              name="customerName"
              required
              placeholder="例: 柳田 太郎"
              className="block w-full rounded-lg border border-line px-3 py-2 text-sm text-ink"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-ink-soft">施工日（任意・未入力は当日）</span>
            <input
              type="date"
              name="workedAt"
              className="block w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
            />
          </label>
          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-ink-soft">Driver（任意・本店のみ）</span>
            <input
              type="text"
              name="driver"
              placeholder="ECM Titanium等のDriver名"
              className="block w-full rounded-lg border border-line px-3 py-2 font-mono text-sm text-ink"
            />
            <label className="mt-1 inline-flex items-center gap-1.5 text-xs text-ink-soft">
              <input type="checkbox" name="driverBorrowed" value="true" className="h-3.5 w-3.5 accent-gold-500" />
              流用（他Driverを流用）
            </label>
          </label>
        </div>
        <input
          type="file"
          name="slaveFile"
          required
          className="block w-full text-sm text-ink file:mr-3 file:min-h-11 file:rounded-lg file:border-0 file:bg-gold-500 file:px-4 file:text-sm file:font-semibold file:text-white"
        />
        {/* 対象ユニット（ECU/TCU）— 同時施工の取り違え防止。表示・ファイル名に入る */}
        <div className="flex items-center gap-3 text-xs text-ink-soft">
          <span className="font-semibold">対象ユニット</span>
          <label className="inline-flex items-center gap-1.5">
            <input type="radio" name="unit" value="ECU" defaultChecked className="h-4 w-4 accent-gold-500" />
            ECU（エンジン）
          </label>
          <label className="inline-flex items-center gap-1.5">
            <input type="radio" name="unit" value="TCU" className="h-4 w-4 accent-sky-500" />
            TCU（ミッション）
          </label>
        </div>
        <label className="flex items-start gap-2 text-xs text-ink-soft">
          <input type="checkbox" name="isTuned" value="true" className="mt-0.5 h-4 w-4 accent-gold-500" />
          <span>
            このファイルは<b>チューニング済み</b>（純正ではない）。純正(ori)扱い・カタログ自動取込をしません。
          </span>
        </label>
        <FormError message={state.error} />
        {state.ok && (
          <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
            復号が完了しました。記録へ移動します…
          </p>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? "アップロード・解析中…" : "アップロードして解析"}
        </Button>
      </form>
    </Card>
  );
}
