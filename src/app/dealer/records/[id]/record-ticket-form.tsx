"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, FormError } from "@/components/ui";
import { emptyFormState } from "@/lib/actions/form-state";
import { createRecordTicket } from "@/lib/actions/requests";

// 配信後の「調整」や「現車合わせ(ログ反映)」を本店へリクエストするフォーム（記録ごと）。
export function RecordTicketForm({ recordId }: { recordId: string }) {
  const action = createRecordTicket.bind(null, recordId);
  const [state, formAction, pending] = useActionState(action, emptyFormState);
  const [open, setOpen] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      setOpen(false);
      router.refresh();
    }
  }, [state, router]);

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-gold-300 bg-white px-4 py-2 text-sm font-semibold text-gold-700 hover:bg-gold-50"
      >
        ＋ ファイル調整・現車合わせをリクエスト
      </button>
    );
  }

  return (
    <form ref={formRef} action={formAction} className="space-y-3 rounded-lg border border-line p-3">
      <div>
        <div className="mb-1.5 text-xs font-semibold text-ink-soft">種別</div>
        <div className="flex flex-wrap gap-4 text-sm text-ink">
          <label className="inline-flex items-center gap-1.5">
            <input type="radio" name="kind" value="adjust" defaultChecked className="accent-gold-500" />
            調整（例: もっと大きいバブリング、ステージUP）
          </label>
          <label className="inline-flex items-center gap-1.5">
            <input type="radio" name="kind" value="custom" className="accent-gold-500" />
            現車合わせ（ログ反映）
          </label>
        </div>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-ink-soft">内容（必須）</span>
        <textarea
          name="content"
          required
          rows={3}
          placeholder="例: バブリングをもっと大きくしたい / ログを取ったらノッキング気味なので少し落としたい 等"
          className="block w-full rounded-lg border border-line px-3 py-2 text-sm text-ink"
        />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-ink-soft">
          走行ログ・参考ファイル（任意）
        </span>
        <input
          type="file"
          name="logFile"
          className="block w-full text-sm text-ink file:mr-3 file:min-h-10 file:rounded-lg file:border-0 file:bg-surface-2 file:px-3 file:text-sm file:font-semibold file:text-ink"
        />
      </label>

      <FormError message={state.error} />
      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "送信中…" : "リクエストを送信"}
        </Button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg px-4 py-2 text-sm font-semibold text-ink-soft hover:bg-surface-2"
        >
          とじる
        </button>
      </div>
    </form>
  );
}
