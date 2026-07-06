"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, FormError } from "@/components/ui";
import { emptyFormState } from "@/lib/actions/form-state";
import { uploadMasterFileRecord } from "@/lib/actions/records";

// Master File（Powergate3・生bin）をアップロード＝施工記録を自動生成し、
// カタログ照合まで完了。可能なバリエーションがそのまま選べる。
export function MasterFileUpload() {
  const [state, formAction, pending] = useActionState(
    uploadMasterFileRecord,
    emptyFormState,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      const recordId = state.data?.recordId as string | undefined;
      if (recordId) router.push(`/dealer/records/${recordId}`);
      else router.refresh();
    }
  }, [state, router]);

  return (
    <Card className="border-sky-200 bg-sky-50">
      <h2 className="text-sm font-bold text-ink">マスターファイルをアップロード</h2>
      <p className="mt-0.5 text-xs text-ink-soft">
        Powergate3 の Master File（読み出した生bin）をアップすると自動で照合まで完了し、
        <b>可能なバリエーション</b>を選んで Master File でダウンロード／リクエストできます。
      </p>
      <form ref={formRef} action={formAction} className="mt-3 space-y-3">
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
        <input
          type="file"
          name="masterFile"
          required
          className="block w-full text-sm text-ink file:mr-3 file:min-h-11 file:rounded-lg file:border-0 file:bg-sky-500 file:px-4 file:text-sm file:font-semibold file:text-white"
        />
        {/* 対象ユニット（ECU/TCU）— 同時施工の取り違え防止 */}
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
        <FormError message={state.error} />
        {state.ok && (
          <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
            取込が完了しました。記録へ移動します…
          </p>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? "アップロード・照合中…" : "アップロードして照合"}
        </Button>
      </form>
    </Card>
  );
}
