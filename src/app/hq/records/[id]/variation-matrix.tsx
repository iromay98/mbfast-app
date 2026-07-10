"use client";

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { emptyFormState } from "@/lib/actions/form-state";
import { uploadVariation, deleteVariation, setVariantStatus } from "@/lib/actions/catalog";
import { tuningContentLabel } from "@/lib/catalog/options";

type Stage = { value: string; label: string };
type VRow = {
  variantId: string | null; // 状態切替（下書き⇄配布可⇄無効）用
  label: string;
  stage: string;
  pops: boolean;
  popsSport: boolean;
  optionTags: string[];
  status: "DRAFT" | "AVAILABLE" | "DISABLED";
  fileName: string | null;
  available: boolean;
  requested: boolean;
};

const popsText = (pops: boolean, sport: boolean) => (pops ? (sport ? "スポーツ" : "全モード") : "—");

const STATUS_LABEL: Record<VRow["status"], string> = {
  DRAFT: "下書き",
  AVAILABLE: "配布可",
  DISABLED: "無効",
};
const STATUS_CLASS: Record<VRow["status"], string> = {
  DRAFT: "bg-gray-100 text-gray-600",
  AVAILABLE: "bg-green-100 text-green-700",
  DISABLED: "bg-gray-100 text-gray-500",
};

// 案件のバリエーション。カタログ同様に一覧表示＋チェック式の追加。
export function VariationBuilder({
  recordId,
  stages,
  showPops,
  optionTags,
  variants,
  openLabels,
}: {
  recordId: string;
  stages: Stage[];
  showPops: boolean;
  optionTags: string[];
  variants: VRow[];
  openLabels: string[];
}) {
  return (
    <div className="space-y-5">
      {/* 一覧（カタログ風） */}
      <div>
        <div className="mb-1.5 text-xs font-semibold text-ink-soft">登録済みバリエーション</div>
        {variants.length === 0 ? (
          <p className="text-xs text-ink-soft">まだ登録がありません。下から追加してください。</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full min-w-[36rem] text-sm">
              <thead className="bg-surface-2 text-xs text-ink-soft">
                <tr>
                  <th className="px-3 py-2 text-left font-semibold">ステージ</th>
                  {showPops && <th className="px-2 py-2 text-center font-semibold">バブリング</th>}
                  {optionTags.map((t) => (
                    <th key={t} className="px-2 py-2 text-center font-semibold">
                      {t}
                    </th>
                  ))}
                  <th className="px-2 py-2 text-left font-semibold">状態</th>
                  <th className="px-3 py-2 text-left font-semibold">ファイル / 差し替え</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {variants.map((row) => (
                  <VariationRow
                    key={row.label}
                    recordId={recordId}
                    row={row}
                    showPops={showPops}
                    optionTags={optionTags}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 追加（チェック式） */}
      <AddVariation
        recordId={recordId}
        stages={stages}
        showPops={showPops}
        optionTags={optionTags}
        existingLabels={variants.map((v) => v.label)}
        availableLabels={variants.filter((v) => v.available).map((v) => v.label)}
        openLabels={openLabels}
      />
    </div>
  );
}

// 一覧の1行（読み取り表示のチェック＋状態＋差し替えアップロード）
function VariationRow({
  recordId,
  row,
  showPops,
  optionTags,
}: {
  recordId: string;
  row: VRow;
  showPops: boolean;
  optionTags: string[];
}) {
  const action = uploadVariation.bind(null, recordId);
  const [state, formAction, pending] = useActionState(action, emptyFormState);
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  const [deleting, startDelete] = useTransition();
  const [delError, setDelError] = useState<string | null>(null);
  useEffect(() => {
    if (state.ok) {
      formRef.current?.reset();
      router.refresh();
    }
  }, [state, router]);

  const onDelete = () => {
    if (!window.confirm(`「${row.label}」を削除します。よろしいですか？`)) return;
    startDelete(async () => {
      setDelError(null);
      const r = await deleteVariation(recordId, row.stage, row.pops, row.optionTags, row.popsSport);
      if (r.error) setDelError(r.error);
      else router.refresh();
    });
  };

  const [statusPending, startStatus] = useTransition();
  const onStatus = (s: string) => {
    if (!row.variantId) return;
    startStatus(async () => {
      await setVariantStatus(row.variantId!, s);
      router.refresh();
    });
  };

  const dim = row.status === "DISABLED" ? "opacity-60" : "";
  return (
    <tr className={dim}>
      <td className="whitespace-nowrap px-3 py-1.5">
        <div className="flex items-center gap-2">
          <span className="font-medium text-ink">{row.stage || "チューニングなし"}</span>
          {row.requested && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-800">
              依頼あり
            </span>
          )}
        </div>
      </td>
      {showPops && (
        <td className="whitespace-nowrap px-2 py-1.5 text-center text-xs text-ink">
          {popsText(row.pops, row.popsSport)}
        </td>
      )}
      {optionTags.map((t) => (
        <td key={t} className="px-2 py-1.5 text-center">
          <input
            type="checkbox"
            checked={row.optionTags.includes(t)}
            readOnly
            disabled
            className="h-4 w-4 accent-gold-500"
          />
        </td>
      ))}
      <td className="whitespace-nowrap px-2 py-1.5">
        {/* 状態はその場で切替可能（下書き⇄配布可⇄無効）。配布可にすると代理店がDLできる。 */}
        {row.variantId ? (
          <select
            value={row.status}
            disabled={statusPending}
            onChange={(e) => onStatus(e.target.value)}
            className={`rounded-full border-0 px-2 py-0.5 text-[11px] font-medium ${STATUS_CLASS[row.status]} disabled:opacity-50`}
            title="状態を切替（配布可にすると代理店がDLできます）"
          >
            {(Object.keys(STATUS_LABEL) as VRow["status"][]).map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
        ) : (
          <span className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_CLASS[row.status]}`}>
            {STATUS_LABEL[row.status]}
          </span>
        )}
      </td>
      <td className="px-3 py-1.5">
        {/* ファイル名はフルで表示（長ければ折り返して2行になってもよい） */}
        {row.fileName && (
          <div className="mb-1 break-all text-xs text-ink-soft">{row.fileName}</div>
        )}
        <form ref={formRef} action={formAction} className="flex items-center gap-1.5">
          <input type="hidden" name="stage" value={row.stage} />
          <input type="hidden" name="pops" value={row.pops ? "1" : "0"} />
          <input type="hidden" name="popsSport" value={row.popsSport ? "1" : "0"} />
          <input type="hidden" name="optionTags" value={JSON.stringify(row.optionTags)} />
          <input
            ref={fileRef}
            type="file"
            name="file"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) formRef.current?.requestSubmit();
            }}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={pending}
            className="shrink-0 rounded-md border border-line px-2.5 py-1.5 text-xs font-semibold text-ink-soft hover:bg-surface-2 disabled:opacity-50"
          >
            {pending ? "…" : "差し替え"}
          </button>
          <button
            type="button"
            onClick={onDelete}
            disabled={deleting}
            className="shrink-0 rounded-md border border-red-200 px-2.5 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            {deleting ? "…" : "削除"}
          </button>
          {(state.error || delError) && (
            <span className="text-xs text-red-600">{state.error || delError}</span>
          )}
        </form>
      </td>
    </tr>
  );
}

// チェック式の追加フォーム
function AddVariation({
  recordId,
  stages,
  showPops,
  optionTags,
  existingLabels,
  availableLabels,
  openLabels,
}: {
  recordId: string;
  stages: Stage[];
  showPops: boolean;
  optionTags: string[];
  existingLabels: string[];
  availableLabels: string[];
  openLabels: string[];
}) {
  const [stage, setStage] = useState(stages[0]?.value ?? "");
  const [popsMode, setPopsMode] = useState<"none" | "all" | "sport">("none");
  const [selected, setSelected] = useState<string[]>([]);
  const pops = popsMode !== "none";
  const popsSport = popsMode === "sport";

  const action = uploadVariation.bind(null, recordId);
  const [state, formAction, pending] = useActionState(action, emptyFormState);
  const formRef = useRef<HTMLFormElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const router = useRouter();
  useEffect(() => {
    if (state.ok) router.refresh();
  }, [state, router]);

  const label = useMemo(
    () => tuningContentLabel(stage, pops, selected, popsSport),
    [stage, pops, popsSport, selected],
  );
  const exists = availableLabels.includes(label);
  const drafted = existingLabels.includes(label) && !exists;
  const requested = openLabels.includes(label);

  const toggleOpt = (t: string) =>
    setSelected((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  return (
    <div className="rounded-lg border border-line p-3">
      <div className="mb-2 text-xs font-semibold text-ink-soft">バリエーションを追加</div>

      <div className="mb-3">
        <div className="mb-1.5 text-xs text-ink-soft">ステージ</div>
        <div className="flex flex-wrap gap-2">
          {stages.map((s) => (
            <button
              key={s.value}
              type="button"
              onClick={() => setStage(s.value)}
              className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${
                stage === s.value
                  ? "border-gold-400 bg-gold-500 text-white"
                  : "border-line bg-white text-ink-soft hover:bg-surface-2"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {showPops && (
        <div className="mb-3">
          <div className="mb-1.5 text-xs text-ink-soft">バブリング</div>
          <div className="flex flex-wrap gap-2">
            {([
              ["none", "なし"],
              ["all", "全モード"],
              ["sport", "スポーツ"],
            ] as const).map(([v, lbl]) => (
              <button
                key={v}
                type="button"
                onClick={() => setPopsMode(v)}
                className={`rounded-lg border px-3 py-1.5 text-sm font-semibold ${
                  popsMode === v
                    ? "border-gold-400 bg-gold-500 text-white"
                    : "border-line bg-white text-ink-soft hover:bg-surface-2"
                }`}
              >
                {lbl}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mb-3">
        <div className="mb-1.5 text-xs text-ink-soft">オプション</div>
        <div className="flex flex-wrap gap-3">
          {optionTags.map((t) => (
            <label key={t} className="inline-flex items-center gap-1.5 text-sm text-ink">
              <input
                type="checkbox"
                checked={selected.includes(t)}
                onChange={() => toggleOpt(t)}
                className="h-4 w-4 accent-gold-500"
              />
              {t}
            </label>
          ))}
        </div>
      </div>

      <div className="mb-2 flex flex-wrap items-center gap-2 border-t border-line pt-2 text-sm">
        <span className="font-semibold text-ink">{label}</span>
        {requested && (
          <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-bold text-amber-800">
            依頼あり・未返却
          </span>
        )}
        {exists ? (
          <span className="text-xs font-semibold text-green-700">登録済み（配布可）→ 差し替え</span>
        ) : drafted ? (
          <span className="text-xs text-ink-soft">下書きあり → アップで配布可</span>
        ) : (
          <span className="text-xs text-ink-soft">未登録 → 新規アップ</span>
        )}
      </div>

      <form ref={formRef} action={formAction} className="flex flex-wrap items-center gap-2">
        <input type="hidden" name="stage" value={stage} />
        <input type="hidden" name="pops" value={pops ? "1" : "0"} />
        <input type="hidden" name="popsSport" value={popsSport ? "1" : "0"} />
        <input type="hidden" name="optionTags" value={JSON.stringify(selected)} />
        <input
          ref={fileRef}
          type="file"
          name="file"
          className="hidden"
          onChange={(e) => {
            if (e.target.files?.length) formRef.current?.requestSubmit();
          }}
        />
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          disabled={pending}
          className="shrink-0 rounded-lg bg-gold-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {pending ? "アップ中…" : exists ? "差し替え" : "アップロード"}
        </button>
        {state.error && <span className="text-xs text-red-600">{state.error}</span>}
        {state.ok && (
          <span className="text-xs font-semibold text-green-700">
            反映しました{(state.data?.delivered as number) > 0 ? "・依頼を納品" : ""}
          </span>
        )}
      </form>
    </div>
  );
}
