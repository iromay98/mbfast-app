"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, FormError } from "@/components/ui";
import { emptyFormState } from "@/lib/actions/form-state";
import { uploadSlaveRecord } from "@/lib/actions/records";

// スレーブをアップロード＝施工記録を自動生成（アップ即時に一覧へ行が出現）
export function SlaveUpload() {
  const [state, formAction, pending] = useActionState(
    uploadSlaveRecord,
    emptyFormState,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      // 復号完了済み。すぐ依頼内容を選べるよう記録詳細へ遷移する。
      const recordId = state.data?.recordId as string | undefined;
      if (recordId) router.push(`/dealer/records/${recordId}`);
      else router.refresh();
    }
  }, [state, router]);

  return (
    <Card className="border-gold-200 bg-gold-50">
      <h2 className="text-sm font-bold text-ink">スレーブファイルをアップロード</h2>
      <p className="mt-0.5 text-xs text-ink-soft">
        アップロードすると自動で復号・照合まで完了し、そのまま依頼内容を選んでダウンロード／リクエストできます。
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
          name="slaveFile"
          required
          className="block w-full text-sm text-ink file:mr-3 file:min-h-11 file:rounded-lg file:border-0 file:bg-gold-500 file:px-4 file:text-sm file:font-semibold file:text-white"
        />
        <label className="flex items-start gap-2 text-xs text-ink-soft">
          <input type="checkbox" name="isTuned" value="true" className="mt-0.5 h-4 w-4 accent-gold-500" />
          <span>
            このファイルは<b>チューニング済み</b>（純正ではない）。チェックすると純正(ori)として扱いません。
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
