"use client";

import { useActionState, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, Button, FormError } from "@/components/ui";
import { emptyFormState } from "@/lib/actions/form-state";
import { addServiceLog, deleteServiceLog } from "@/lib/actions/records";

export type ServiceLogItem = {
  id: string;
  performedAtLabel: string;
  content: string;
  note: string | null;
};

// 手動の施工ログ。過去客の遡り登録など「いつ・何を施工したか」を本店が記録。
// canEdit=本店のみ追加/削除。代理店は閲覧のみ。
export function ServiceLog({
  recordId,
  logs,
  canEdit,
}: {
  recordId: string;
  logs: ServiceLogItem[];
  canEdit: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    addServiceLog.bind(null, recordId),
    emptyFormState,
  );
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const [deleting, startDelete] = useTransition();
  const [delId, setDelId] = useState<string | null>(null);

  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      router.refresh();
    }
  }, [state, router]);

  const onDelete = (id: string) => {
    if (!window.confirm("この施工ログを削除します。よろしいですか？")) return;
    setDelId(id);
    startDelete(async () => {
      await deleteServiceLog(id);
      setDelId(null);
      router.refresh();
    });
  };

  const inp = "rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm";

  return (
    <Card>
      <h3 className="mb-1 text-sm font-bold text-ink">施工ログ</h3>
      <p className="mb-3 text-xs text-ink-soft">
        いつ・どんな施工をしたかの記録です。アプリ導入前の過去案件もここに遡って残せます。
      </p>

      {logs.length === 0 ? (
        <p className="text-xs text-ink-soft">まだ施工ログはありません。</p>
      ) : (
        <ol className="relative space-y-2 border-l border-line pl-4">
          {logs.map((l) => (
            <li key={l.id} className="relative">
              <span className="absolute -left-[21px] top-1.5 h-2.5 w-2.5 rounded-full border-2 border-gold-400 bg-white" />
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-ink">{l.content}</div>
                  <div className="mt-0.5 text-xs text-ink-soft">
                    {l.performedAtLabel}
                    {l.note ? `・${l.note}` : ""}
                  </div>
                </div>
                {canEdit && (
                  <button
                    type="button"
                    onClick={() => onDelete(l.id)}
                    disabled={deleting && delId === l.id}
                    className="shrink-0 rounded-md border border-red-200 px-2 py-1 text-[11px] font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    {deleting && delId === l.id ? "…" : "削除"}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ol>
      )}

      {canEdit && (
        <form ref={formRef} action={formAction} className="mt-4 space-y-2 border-t border-line pt-3">
          <div className="flex flex-wrap items-end gap-2">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold text-ink-soft">施工日</span>
              <input type="date" name="performedAt" className={inp} />
            </label>
            <label className="block min-w-[12rem] flex-1">
              <span className="mb-1 block text-[11px] font-semibold text-ink-soft">施工内容 *</span>
              <input
                type="text"
                name="content"
                required
                placeholder="例: Stage1＋バブリング(全モード)"
                className={`${inp} w-full`}
              />
            </label>
          </div>
          <input
            type="text"
            name="note"
            placeholder="補足メモ（任意）"
            className={`${inp} w-full`}
          />
          <FormError message={state.error} />
          <Button type="submit" disabled={pending}>
            {pending ? "追加中…" : "施工ログを追加"}
          </Button>
        </form>
      )}
    </Card>
  );
}
