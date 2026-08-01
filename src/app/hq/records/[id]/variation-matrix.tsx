"use client";

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { emptyFormState } from "@/lib/actions/form-state";
import {
  uploadVariation,
  deleteVariation,
  setVariantStatus,
  updateVariant,
  setCurrentVersion,
  updateVersionMeta,
} from "@/lib/actions/catalog";
import { tuningContentLabel, stripPopsStrongIfNoPops, POPS_STRONG_TAG } from "@/lib/catalog/options";

type Stage = { value: string; label: string };
// この行の1版（TunedVariantVersion）。公開版の選び直し・履歴表示に使う。
type VVer = {
  id: string;
  version: number; // 内部連番
  label: string; // 本部が付ける ver名
  note: string; // 特徴メモ
  fileName: string | null;
  fileSize: number | null;
  replacedAtLabel: string;
  replacedByName: string;
  isCurrent: boolean; // 現行＝公開中の版か
};
type VRow = {
  variantId: string | null; // 状態切替（下書き⇄配布可⇄無効）用
  verLabel: string; // 現行ファイルの ver名（カタログの版履歴で編集）
  verNote: string; // 現行ファイルの特徴メモ
  label: string;
  stage: string;
  pops: boolean;
  popsSport: boolean;
  optionTags: string[];
  status: "DRAFT" | "AVAILABLE" | "DISABLED";
  fileName: string | null;
  available: boolean;
  requested: boolean;
  extraTags: string[]; // この純正の選択肢に無いOP（チェック列に出ないので明示）
  dupes: number; // 同じ構成で残っている重複行の数
  versions: VVer[]; // この行の全版（version 降順）
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
  const [showVersions, setShowVersions] = useState(false);
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
  // オプションはその場で編集可（例: 既存バブリングを「バブリング強(触媒無視)」に振り分け）
  const onToggleTag = (tag: string, checked: boolean) => {
    if (!row.variantId) return;
    const next = checked ? [...row.optionTags, tag] : row.optionTags.filter((t) => t !== tag);
    startStatus(async () => {
      await updateVariant(row.variantId!, { optionTags: next });
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
        {/* この純正では選択肢に無いOP。チェック列に出ないので、ここに出さないと
            「何の行なのか分からないまま差し替える」ことになる。 */}
        {row.extraTags.length > 0 && (
          <div className="mt-0.5 text-[11px] text-amber-700" title="この純正の選択肢には無いオプションです">
            OP: {row.extraTags.join("・")}
          </div>
        )}
        {row.dupes > 0 && (
          <div className="mt-0.5 text-[11px] text-ink-soft" title="同じ構成の行が複数あります。差し替えると同じファイルに揃えます。">
            同構成の重複 {row.dupes}件
          </div>
        )}
      </td>
      {showPops && (
        <td className="whitespace-nowrap px-2 py-1.5 text-center text-xs text-ink">
          {popsText(row.pops, row.popsSport)}
        </td>
      )}
      {optionTags.map((t) => {
        // バブリング強はバブリングありの行でのみ付けられる
        const strongLocked = t === POPS_STRONG_TAG && !row.pops;
        return (
          <td key={t} className="px-2 py-1.5 text-center">
            <input
              type="checkbox"
              checked={row.optionTags.includes(t)}
              disabled={!row.variantId || statusPending || strongLocked}
              onChange={(e) => onToggleTag(t, e.target.checked)}
              title={
                strongLocked
                  ? "バブリングありの行でのみ選べます"
                  : "クリックで切替（例: 既存バブリングを『強(触媒無視)』へ振り分け）"
              }
              className="h-4 w-4 cursor-pointer accent-gold-500 disabled:cursor-not-allowed"
            />
          </td>
        );
      })}
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
          <div className="mb-1 break-all text-xs text-ink-soft">
            {row.fileName}
            {(row.verLabel || row.verNote) && (
              <span
                title={row.verNote || undefined}
                className="ml-1.5 rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700"
              >
                {row.verLabel || "ver"}
                {row.verNote ? `｜${row.verNote}` : ""}
              </span>
            )}
          </div>
        )}
        <form ref={formRef} action={formAction} className="flex flex-wrap items-center gap-1.5">
          {/* 差し替えは行そのもの(variantId)を狙う。構成から引き直すと選択肢外のOPが落ちて
              別の行を書き換えてしまう（＝差し替えたのに差し替わらない）ため。 */}
          {row.variantId && <input type="hidden" name="variantId" value={row.variantId} />}
          <input type="hidden" name="stage" value={row.stage} />
          <input type="hidden" name="pops" value={row.pops ? "1" : "0"} />
          <input type="hidden" name="popsSport" value={row.popsSport ? "1" : "0"} />
          <input type="hidden" name="optionTags" value={JSON.stringify(row.optionTags)} />
          {/* 任意の「ver名」。差し替えでアップする版に付く（空なら無し）。 */}
          <input
            type="text"
            name="verLabel"
            placeholder="ver名(任意)"
            title="この差し替えでアップする版に付く呼び名（例: ver2・-15 2000~）。空でも可。"
            className="w-24 shrink-0 rounded-md border border-line px-2 py-1.5 text-xs text-ink placeholder:text-ink-soft/60"
          />
          <input
            ref={fileRef}
            type="file"
            name="file"
            className="hidden"
            onChange={(e) => {
              if (e.target.files?.length) formRef.current?.requestSubmit();
            }}
          />
          {/* 本部DL: .bin=登録されている生チューニング / .slave=この車用に再暗号化。
              .bin は ?recordId でファイル名に顧客名が入る（本部のみ）。 */}
          {row.variantId && row.fileName && (
            <a
              href={`/api/catalog/variants/${row.variantId}/file?recordId=${recordId}`}
              download
              title="登録されているチューニング済みbin（本店のみ・ファイル名にCal＋顧客名）"
              className="shrink-0 rounded-md border border-line px-2.5 py-1.5 text-xs font-semibold text-ink-soft hover:bg-surface-2"
            >
              .bin
            </a>
          )}
          {row.variantId && row.available && (
            <a
              href={`/api/match/${recordId}/variant/${row.variantId}`}
              download
              title="この車用に再暗号化した焼ける .slave"
              className="shrink-0 rounded-md border border-gold-300 px-2.5 py-1.5 text-xs font-semibold text-gold-700 hover:bg-gold-50"
            >
              .slave
            </a>
          )}
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={pending}
            className="shrink-0 rounded-md border border-line px-2.5 py-1.5 text-xs font-semibold text-ink-soft hover:bg-surface-2 disabled:opacity-50"
          >
            {pending ? "…" : "差し替え"}
          </button>
          {/* 版一覧（過去の版を選び直す導線）。1版以上あるときだけ出す。 */}
          {row.variantId && row.versions.length > 0 && (
            <button
              type="button"
              onClick={() => setShowVersions((s) => !s)}
              className="shrink-0 rounded-md border border-line px-2.5 py-1.5 text-xs font-semibold text-ink-soft hover:bg-surface-2"
              title="この行の版履歴を開いて公開する版を選び直す"
            >
              版 {row.versions.length}
              {showVersions ? " ▲" : " ▼"}
            </button>
          )}
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
          {/* 同じ構成の重複行があった場合は黙って直さず件数を出す（配信は同じ構成を引くため揃える） */}
          {state.ok && Number(state.data?.unified ?? 0) > 0 && (
            <span className="text-xs text-ink-soft">
              同じ構成の重複{String(state.data?.unified)}件も同じファイルに揃えました
            </span>
          )}
        </form>
        {row.variantId && showVersions && row.versions.length > 0 && (
          <VersionList recordId={recordId} variantId={row.variantId} versions={row.versions} />
        )}
      </td>
    </tr>
  );
}

// 版一覧（この行の全 TunedVariantVersion）。公開する版の選び直しと ver名/メモ編集。
function VersionList({
  recordId,
  variantId,
  versions,
}: {
  recordId: string;
  variantId: string;
  versions: VVer[];
}) {
  const router = useRouter();
  const [busy, startBusy] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const onPublish = (versionId: string) => {
    startBusy(async () => {
      setError(null);
      const r = await setCurrentVersion(variantId, versionId, recordId);
      if (r.error) setError(r.error);
      else router.refresh();
    });
  };

  return (
    <div className="mt-2 rounded-lg border border-line bg-surface-2/50 p-2">
      <div className="mb-1.5 text-[11px] font-semibold text-ink-soft">版の履歴（公開する版を選べます）</div>
      <div className="space-y-1.5">
        {versions.map((ver) => (
          <VersionRow key={ver.id} ver={ver} busy={busy} onPublish={() => onPublish(ver.id)} />
        ))}
      </div>
      {error && <div className="mt-1 text-xs text-red-600">{error}</div>}
    </div>
  );
}

function VersionRow({
  ver,
  busy,
  onPublish,
}: {
  ver: VVer;
  busy: boolean;
  onPublish: () => void;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [label, setLabel] = useState(ver.label);
  const [note, setNote] = useState(ver.note);
  const [saving, startSave] = useTransition();
  const [saveError, setSaveError] = useState<string | null>(null);

  const onSave = () => {
    startSave(async () => {
      setSaveError(null);
      const r = await updateVersionMeta(ver.id, { label, note });
      if (r.error) setSaveError(r.error);
      else {
        setEditing(false);
        router.refresh();
      }
    });
  };

  return (
    <div
      className={`rounded-md border px-2 py-1.5 text-xs ${
        ver.isCurrent ? "border-green-300 bg-green-50" : "border-line bg-white"
      }`}
    >
      <div className="flex flex-wrap items-center gap-1.5">
        <span className="font-semibold text-ink">v{ver.version}</span>
        {ver.label && (
          <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700">
            {ver.label}
          </span>
        )}
        {ver.isCurrent ? (
          <span className="rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold text-green-700">
            公開中
          </span>
        ) : (
          <button
            type="button"
            onClick={onPublish}
            disabled={busy}
            className="rounded-md border border-gold-300 px-2 py-0.5 text-[11px] font-semibold text-gold-700 hover:bg-gold-50 disabled:opacity-50"
            title="この版を現行（公開）にする。次回DLからこの版が出ます。"
          >
            {busy ? "…" : "この版を公開"}
          </button>
        )}
        {/* 版ごとの本部bin（履歴確認用・ファイル名に v番号が入る） */}
        {ver.fileName && (
          <a
            href={`/api/catalog/versions/${ver.id}/file`}
            download
            title="この版のチューニング済みbin（本店のみ）"
            className="rounded-md border border-line px-2 py-0.5 text-[11px] font-semibold text-ink-soft hover:bg-surface-2"
          >
            .bin
          </a>
        )}
        <button
          type="button"
          onClick={() => setEditing((e) => !e)}
          className="rounded-md border border-line px-2 py-0.5 text-[11px] font-semibold text-ink-soft hover:bg-surface-2"
        >
          {editing ? "閉じる" : "ver名/メモ"}
        </button>
      </div>
      {ver.fileName && <div className="mt-0.5 break-all text-[11px] text-ink-soft">{ver.fileName}</div>}
      {ver.note && !editing && <div className="mt-0.5 text-[11px] text-ink-soft">{ver.note}</div>}
      <div className="mt-0.5 text-[10px] text-ink-soft/80">
        {ver.replacedAtLabel}
        {ver.replacedByName ? `・${ver.replacedByName}` : ""}
      </div>
      {editing && (
        <div className="mt-1.5 flex flex-wrap items-center gap-1.5 border-t border-line pt-1.5">
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="ver名"
            className="w-24 rounded-md border border-line px-2 py-1 text-[11px] text-ink"
          />
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="特徴メモ"
            className="min-w-[10rem] flex-1 rounded-md border border-line px-2 py-1 text-[11px] text-ink"
          />
          <button
            type="button"
            onClick={onSave}
            disabled={saving}
            className="rounded-md bg-gold-500 px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
          >
            {saving ? "保存中…" : "保存"}
          </button>
          {saveError && <span className="text-[11px] text-red-600">{saveError}</span>}
        </div>
      )}
    </div>
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

  // バブリング「なし」に戻したら「強」タグも外す（強はバブリング選択時のみ有効）
  const changePopsMode = (v: "none" | "all" | "sport") => {
    setPopsMode(v);
    if (v === "none") setSelected((prev) => stripPopsStrongIfNoPops(prev, false));
  };

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
                onClick={() => changePopsMode(v)}
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
          {optionTags.map((t) => {
            // バブリング強はバブリング選択時のみ選べる
            const strongLocked = t === POPS_STRONG_TAG && popsMode === "none";
            return (
              <label
                key={t}
                className={`inline-flex items-center gap-1.5 text-sm ${strongLocked ? "text-ink-soft/50" : "text-ink"}`}
                title={strongLocked ? "バブリングを選択すると選べます" : undefined}
              >
                <input
                  type="checkbox"
                  checked={selected.includes(t)}
                  disabled={strongLocked}
                  onChange={() => toggleOpt(t)}
                  className="h-4 w-4 accent-gold-500 disabled:cursor-not-allowed"
                />
                {t}
              </label>
            );
          })}
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
        {/* 任意の「ver名」。アップする版に付く（空なら無し・内部連番は自動）。 */}
        <input
          type="text"
          name="verLabel"
          placeholder="ver名(任意)"
          title="アップする版に付く呼び名（例: ver1・初版）。空でも可。"
          className="w-28 rounded-lg border border-line px-2.5 py-2 text-sm text-ink placeholder:text-ink-soft/60"
        />
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
