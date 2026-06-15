"use client";

import { useActionState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { postRecordMessage } from "@/lib/actions/messages";
import { emptyFormState } from "@/lib/actions/form-state";
import { Button, FormError } from "@/components/ui";

// 案件メッセージの投稿（テキスト＋任意の添付ファイル）。
export function MessageComposer({ recordId }: { recordId: string }) {
  const [state, formAction, pending] = useActionState(
    postRecordMessage.bind(null, recordId),
    emptyFormState,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      router.refresh();
    }
  }, [state, router]);

  return (
    <form ref={formRef} action={formAction} className="space-y-2">
      <textarea
        name="body"
        rows={2}
        placeholder="メッセージ（質問・別リクエストなど）"
        className="block w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
      />
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="file"
          name="file"
          className="text-xs text-ink-soft file:mr-2 file:rounded-lg file:border-0 file:bg-surface-2 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:text-ink-soft"
        />
        <Button type="submit" disabled={pending}>
          {pending ? "送信中…" : "送信"}
        </Button>
      </div>
      <FormError message={state.error} />
    </form>
  );
}
