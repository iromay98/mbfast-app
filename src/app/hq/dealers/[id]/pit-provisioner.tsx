"use client";

import { useActionState } from "react";
import { Button, Field, FormError, Input } from "@/components/ui";
import { emptyFormState } from "@/lib/actions/form-state";
import { provisionDealerPit } from "@/lib/actions/dealers";

/*
 * 既存代理店へのmbPIT機能の遡り付与（1件ずつ）。
 * 「確認だけ」= ドライラン（何が作られるか・衝突が無いかをWPに問い合わせて表示。書き込み無し）
 * 「開設する」= 実行（店舗レコード→WPカテゴリ→店舗ページ→店舗情報同期→案内メール）
 */
export function PitProvisioner({ dealerId, suggestedSlug }: { dealerId: string; suggestedSlug: string }) {
  const [state, formAction, pending] = useActionState(provisionDealerPit, emptyFormState);
  const fe = state.fieldErrors ?? {};
  const d = state.ok ? state.data : undefined;
  const issues = String(d?.issues ?? "");
  const notes = String(d?.notes ?? "");

  return (
    <div className="space-y-3">
      <form action={formAction} className="space-y-3">
        <input type="hidden" name="dealerId" value={dealerId} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="店舗slug（URL用）"
            hint={fe.slug ?? "英小文字・数字・ハイフン。空欄なら店名から自動生成。-mbpit 等の接尾辞は付けない"}
          >
            <Input name="slug" defaultValue={suggestedSlug} placeholder="例: charism-garage" pattern="[a-zA-Z0-9-]*" />
          </Field>
          <Field label="表示名（空欄なら代理店名）" hint="記事タイトル・店舗ページに使う名前">
            <Input name="displayName" placeholder="例: CharismGarage" />
          </Field>
        </div>
        <FormError message={state.error} />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" variant="secondary" name="dryRun" value="on" disabled={pending}>
            {pending ? "確認中…" : "確認だけ（書き込みなし）"}
          </Button>
          <Button type="submit" disabled={pending}>
            {pending ? "開設中…" : "mbPIT店舗を開設する"}
          </Button>
        </div>
      </form>

      {d && d.dryRun === true && (
        <div
          className={`rounded-lg border p-3 text-sm ${
            d.status === "ready" ? "border-green-200 bg-green-50" : "border-gold-200 bg-gold-50"
          }`}
        >
          <p className="font-medium text-ink">
            {d.status === "ready" && `開設できます: /mbpit/${String(d.slug)}/`}
            {d.status === "exists" && "既にmbPIT店舗が紐付いています"}
            {d.status === "blocked" && "本部の判断が必要です（自動では進めません）"}
          </p>
          {issues && <pre className="mt-2 whitespace-pre-wrap font-sans text-xs text-red-700">{issues}</pre>}
          {notes && <pre className="mt-2 whitespace-pre-wrap font-sans text-xs text-ink-soft">{notes}</pre>}
        </div>
      )}

      {d && d.dryRun === false && (
        <div className="rounded-lg border border-green-200 bg-green-50 p-3 text-sm">
          <p className="font-medium text-ink">
            {d.status === "exists" ? "既に開設済みです" : "mbPIT店舗を開設しました"}
          </p>
          {d.pageUrl ? (
            <p className="mt-1">
              店舗ページ:{" "}
              <a href={String(d.pageUrl)} target="_blank" rel="noopener" className="text-gold-700 underline">
                {String(d.pageUrl)}
              </a>
            </p>
          ) : null}
          {d.mailSent === "yes" && <p className="mt-1 text-xs text-ink-soft">案内メール（mbPIT名義）を送信しました</p>}
          {notes && <pre className="mt-2 whitespace-pre-wrap font-sans text-xs text-ink-soft">{notes}</pre>}
        </div>
      )}
    </div>
  );
}
