"use client";

import { useActionState, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button, FormError } from "@/components/ui";
import { emptyFormState } from "@/lib/actions/form-state";
import { createShowcaseFromRecord } from "@/lib/actions/showcase";

// 施工記録から事例を作成。車両情報は記録から自動流用。動画/ブログ/InstagramはURLを貼るだけ。
export function ShowcaseCreateForm({
  recordId,
  defaultContentLabel,
}: {
  recordId: string;
  defaultContentLabel?: string;
}) {
  const action = createShowcaseFromRecord.bind(null, recordId);
  const [state, formAction, pending] = useActionState(action, emptyFormState);
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const fe = state.fieldErrors ?? {};

  useEffect(() => {
    // 成功したら閉じて一覧を最新化
    if (state.ok) {
      setOpen(false);
      router.refresh();
    }
  }, [state.ok, router]);

  const inp = "block w-full rounded-lg border border-line px-3 py-2 text-sm text-ink";

  if (!open) {
    return (
      <div>
        <Button type="button" variant="secondary" onClick={() => setOpen(true)}>
          ★ この施工を事例として公開
        </Button>
        {state.ok && (
          <p className="mt-2 rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
            事例を作成しました。
          </p>
        )}
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-3 rounded-xl border border-line bg-surface p-4">
      <p className="text-xs text-ink-soft">
        車両情報（メーカー・車種・世代・グレード）はこの施工記録から自動で引き継ぎます。
      </p>
      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-ink-soft">タイトル *</span>
        <input name="title" required placeholder="例: RS3 バブリング仕様 施工事例" className={inp} />
        {fe.title && <span className="text-xs text-red-600">{fe.title}</span>}
      </label>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-ink-soft">内容ラベル（任意）</span>
          <input name="contentLabel" defaultValue={defaultContentLabel ?? ""} placeholder="例: Stage1・バブリング" className={inp} />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-ink-soft">ステージ（任意）</span>
          <input name="stage" placeholder="例: Stage1" className={inp} />
        </label>
      </div>

      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-ink-soft">コメント（任意）</span>
        <textarea name="comment" rows={3} placeholder="このバブリングは○○仕様、など" className={inp} />
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-ink-soft">
          動画・ブログ・InstagramのURL（1行に1つ）
        </span>
        <textarea
          name="embedUrl"
          rows={3}
          placeholder={"https://youtu.be/xxxx\nhttps://www.instagram.com/p/xxxx/\nhttps://blog.example.com/case-123"}
          className={`${inp} font-mono text-xs`}
        />
        <span className="mt-1 block text-[11px] text-ink-soft">
          ※ ダウンロードせずリンク/埋め込みで表示します（YouTube・Instagramはそのまま再生表示）。
        </span>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs font-semibold text-ink-soft">カバー画像URL（任意・自社撮影のみ）</span>
        <input name="coverImage" placeholder="https://…" className={`${inp} font-mono text-xs`} />
      </label>

      <fieldset className="flex flex-wrap items-center gap-4 text-sm">
        <span className="text-xs font-semibold text-ink-soft">公開範囲</span>
        <label className="inline-flex items-center gap-1.5">
          <input type="radio" name="visibility" value="PUBLIC" defaultChecked className="h-4 w-4 accent-green-600" />
          一般公開（客も閲覧可）
        </label>
        <label className="inline-flex items-center gap-1.5">
          <input type="radio" name="visibility" value="DEALER" className="h-4 w-4 accent-sky-500" />
          代理店限定
        </label>
      </fieldset>

      <FormError message={state.error} />
      <div className="flex items-center gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "作成中…" : "事例を公開"}
        </Button>
        <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
          とじる
        </Button>
      </div>
    </form>
  );
}
