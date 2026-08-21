"use client";

import { useActionState, useState } from "react";
import { Button, Card, Field, FormError, Select, Textarea } from "@/components/ui";
import { emptyFormState, type FormState } from "@/lib/actions/form-state";
import { requestStatusLabels } from "@/lib/labels";
import {
  POPS_STRONG_TAG,
  stripPopsStrongIfNoPops,
  tuningContentLabel,
} from "@/lib/catalog/options";

type RecordOption = { id: string; label: string };

/** 「リクエストと異なる仕様」で納品するときの選択肢（紐づいた記録の純正から作る） */
export type DeliverChoices = {
  stages: { value: string; label: string }[];
  showPops: boolean;
  optionTags: string[];
};

export function HQRequestForm({
  action,
  currentStatus,
  currentHqNote,
  currentServiceRecordId,
  recordOptions,
  hasResultFile,
  requestedLabel = null,
  deliverChoices = null,
}: {
  action: (prev: FormState, formData: FormData) => Promise<FormState>;
  currentStatus: keyof typeof requestStatusLabels;
  currentHqNote: string | null;
  currentServiceRecordId: string | null;
  recordOptions: RecordOption[];
  hasResultFile: boolean;
  // リクエスト内容（「…」から抽出したラベル）。自動登録の対象表示用。
  requestedLabel?: string | null;
  // 異なる仕様のときに選べる内容（記録が紐づいていないときは null＝備考のみ）
  deliverChoices?: DeliverChoices | null;
}) {
  const [state, formAction, pending] = useActionState(action, emptyFormState);
  const fe = state.fieldErrors ?? {};
  const [specMatch, setSpecMatch] = useState<"as_requested" | "different">("as_requested");
  const autoMessage = (state.data as { autoMessage?: string } | undefined)?.autoMessage;

  /*
   * 異なる仕様の納品内容。以前は備考の手打ちだけで、バリエーションには登録されなかったため
   * 「実際に渡した内容」がカタログに入らず、次に同じ構成を頼まれても自動DLできなかった。
   * 代理店のコンフィギュレータと同じ選び方（ステージ＋バブリング＋OP）で選ばせ、
   * そのままバリエーションに登録できるようにする。
   */
  const [dStage, setDStage] = useState<string>(
    deliverChoices?.stages.some((s) => s.value === "Stage1") ? "Stage1" : (deliverChoices?.stages[0]?.value ?? ""),
  );
  const [dPopsMode, setDPopsMode] = useState<"none" | "all" | "sport">("none");
  const [dTags, setDTags] = useState<string[]>([]);
  const [registerVariant, setRegisterVariant] = useState(true);
  const dPops = dPopsMode !== "none";
  const dLabel = tuningContentLabel(dStage, dPops, dTags, dPopsMode === "sport");

  const toggleDTag = (t: string) =>
    setDTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  const changeDPops = (v: "none" | "all" | "sport") => {
    setDPopsMode(v);
    if (v === "none") setDTags((prev) => stripPopsStrongIfNoPops(prev, false));
  };

  return (
    <Card>
      <h3 className="mb-3 text-sm font-bold text-ink">本店処理</h3>
      <form action={formAction} className="space-y-4">
        <Field label="ステータス" hint={fe.status}>
          <Select name="status" defaultValue={currentStatus}>
            {Object.entries(requestStatusLabels).map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="成果ファイル（納品ファイル）"
          hint={fe.resultFile ?? (hasResultFile ? "アップロードすると差し替えられます。" : "上限50MB。")}
        >
          <input
            type="file"
            name="resultFile"
            className="block w-full text-sm text-ink file:mr-3 file:min-h-11 file:rounded-lg file:border-0 file:bg-gold-500 file:px-4 file:text-sm file:font-semibold file:text-white"
          />
        </Field>

        {/* 納品内容: リクエスト通りなら納品と同時にバリエーションへ自動登録される */}
        <div className="space-y-1.5">
          <div className="text-xs font-semibold text-ink-soft">納品内容</div>
          <div className="flex flex-col gap-1.5 text-sm">
            <label className="inline-flex items-start gap-2">
              <input
                type="radio"
                name="specMatch"
                value="as_requested"
                checked={specMatch === "as_requested"}
                onChange={() => setSpecMatch("as_requested")}
                className="mt-0.5 h-4 w-4 accent-gold-500"
              />
              <span>
                リクエスト通りの内容
                {requestedLabel && (
                  <span className="ml-1 rounded bg-gold-50 px-1.5 py-0.5 text-xs font-semibold text-gold-700">
                    {requestedLabel}
                  </span>
                )}
                <span className="block text-xs text-ink-soft">
                  納品と同時にバリエーションへ自動登録されます（配布可）。再アップ不要。
                </span>
              </span>
            </label>
            <label className="inline-flex items-start gap-2">
              <input
                type="radio"
                name="specMatch"
                value="different"
                checked={specMatch === "different"}
                onChange={() => setSpecMatch("different")}
                className="mt-0.5 h-4 w-4 accent-sky-500"
              />
              <span>
                リクエストと異なる仕様
                <span className="block text-xs text-ink-soft">
                  {deliverChoices
                    ? "実際に渡した内容を選べます（そのままバリエーションに登録できます）。"
                    : "備考を残せます。※施工記録を紐付けると内容を選んで登録できます。"}
                </span>
              </span>
            </label>
          </div>

          {specMatch === "different" && (
            <div className="space-y-2 rounded-lg border border-sky-200 bg-sky-50/60 p-3">
              {/* 実際に納品した内容を選ぶ（手打ちをやめる）。選択肢は紐づいた純正に沿う */}
              {deliverChoices ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-semibold text-ink-soft">ステージ</span>
                    <select
                      value={dStage}
                      onChange={(e) => setDStage(e.target.value)}
                      className="rounded-lg border border-line bg-surface px-2 py-1 text-sm"
                    >
                      {deliverChoices.stages.map((s) => (
                        <option key={s.value} value={s.value}>
                          {s.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {deliverChoices.showPops && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="mr-1 text-xs font-semibold text-ink-soft">バブリング</span>
                      {([
                        ["none", "なし"],
                        ["all", "全モード"],
                        ["sport", "スポーツ"],
                      ] as const).map(([v, label]) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => changeDPops(v)}
                          className={`rounded-lg border px-2.5 py-1 text-xs font-semibold ${
                            dPopsMode === v
                              ? "border-gold-400 bg-gold-500 text-white"
                              : "border-line bg-white text-ink-soft hover:bg-surface-2"
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  )}

                  {deliverChoices.optionTags.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="mr-1 text-xs font-semibold text-ink-soft">オプション</span>
                      {deliverChoices.optionTags.map((t) => {
                        // バブリング強はバブリング選択時のみ（代理店側と同じ規則）
                        const locked = t === POPS_STRONG_TAG && dPopsMode === "none";
                        const on = dTags.includes(t);
                        return (
                          <label
                            key={t}
                            className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${
                              on ? "border-gold-400 bg-gold-500 text-white" : "border-line bg-white text-ink-soft"
                            } ${locked ? "cursor-not-allowed opacity-40" : "cursor-pointer"}`}
                            title={locked ? "バブリングを選択すると選べます" : undefined}
                          >
                            <input
                              type="checkbox"
                              checked={on}
                              disabled={locked}
                              onChange={() => toggleDTag(t)}
                              className="h-3.5 w-3.5 accent-gold-500"
                            />
                            {t}
                          </label>
                        );
                      })}
                    </div>
                  )}

                  <p className="text-xs text-ink">
                    納品内容: <b className="font-mono">{dLabel}</b>
                  </p>
                  <label className="inline-flex items-start gap-2 text-xs font-medium text-ink">
                    <input
                      type="checkbox"
                      name="registerVariant"
                      checked={registerVariant}
                      onChange={(e) => setRegisterVariant(e.target.checked)}
                      className="mt-0.5 h-4 w-4 accent-gold-500"
                    />
                    <span>
                      この内容でバリエーションに登録する（配布可）
                      <span className="block text-ink-soft">
                        次に同じ構成を頼まれたとき、代理店がそのままDLできます。外すと登録しません。
                      </span>
                    </span>
                  </label>
                  {/* サーバーへは選択値をそのまま渡す（ラベルはサーバー側で組み立て直す） */}
                  <input type="hidden" name="deliveredStage" value={dStage} />
                  <input type="hidden" name="deliveredPops" value={dPops ? "1" : "0"} />
                  <input type="hidden" name="deliveredPopsSport" value={dPopsMode === "sport" ? "1" : "0"} />
                  <input type="hidden" name="deliveredTags" value={JSON.stringify(dTags)} />
                </>
              ) : null}

              <input
                type="text"
                name="specNote"
                placeholder="備考（例: 現車に合わせて弱め）※本店コメントに追記されます"
                className="block w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
              />
            </div>
          )}
        </div>

        <Field label="本店コメント">
          <Textarea name="hqNote" rows={3} defaultValue={currentHqNote ?? ""} />
        </Field>

        <Field label="施工記録への紐付け（任意・納品時）">
          <Select name="serviceRecordId" defaultValue={currentServiceRecordId ?? ""}>
            <option value="">紐付けなし</option>
            {recordOptions.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>

        <FormError message={state.error} />
        {state.ok && (
          <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">
            更新しました。
            {autoMessage && <span className="block text-xs">{autoMessage}</span>}
          </p>
        )}
        <Button type="submit" disabled={pending}>
          {pending ? "更新中…" : "更新する"}
        </Button>
      </form>
    </Card>
  );
}
