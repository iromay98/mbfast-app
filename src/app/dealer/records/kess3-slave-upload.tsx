"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { Button, Card, FormError } from "@/components/ui";
import { emptyFormState } from "@/lib/actions/form-state";
import { uploadKess3SlaveRecord } from "@/lib/actions/records";

// Kess3 Slave（暗号化ファイル）をアップロード＝施工記録を作成し、本部へ通知。
// 復号APIが無いため自動照合はせず、本部（Kess3 Master）が手動で対応する。
export function Kess3SlaveUpload() {
  const [state, formAction, pending] = useActionState(
    uploadKess3SlaveRecord,
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
    <Card className="border-violet-200 bg-violet-50">
      <h2 className="text-sm font-bold text-ink">Kess3 Slaveファイルをアップロード</h2>
      <p className="mt-0.5 text-xs text-ink-soft">
        Kess3（Slaveモード）で読み出したファイルをそのままアップしてください。
        本部が手動で対応し、<b>仕上がりファイルはこの記録に届きます</b>（お使いのKess3でそのまま書き込み）。
        車種・ご希望の内容は下のメモに書いてください。
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
          name="kess3File"
          required
          className="block w-full text-sm text-ink file:mr-3 file:min-h-11 file:rounded-lg file:border-0 file:bg-violet-500 file:px-4 file:text-sm file:font-semibold file:text-white"
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
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-ink-soft">
            車種・ご希望の内容（本部への伝達メモ）
          </span>
          <textarea
            name="note"
            rows={3}
            placeholder="例: BMW F30 320i／Stage1＋バブリング希望"
            className="block w-full rounded-lg border border-line px-3 py-2 text-sm text-ink"
          />
        </label>
        <FormError message={state.error} />
        {state.ok && (
          <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
            受け付けました。記録へ移動します…
          </p>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? "アップロード中…" : "アップロードして本部へ送る"}
        </Button>
      </form>
    </Card>
  );
}
