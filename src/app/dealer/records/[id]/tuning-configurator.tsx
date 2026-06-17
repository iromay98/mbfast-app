"use client";

import { useEffect, useState, useTransition } from "react";
import { resolveTuning, requestTuning } from "@/lib/actions/requests";
import { SPEED_LIMITER_TAG, tuningContentLabel } from "@/lib/catalog/options";
import { DownloadConsent } from "./download-consent";

type Stage = { value: string; label: string };
type Selection = { stage: string; pops: boolean; popsSport: boolean; optionTags: string[] };
type Resolved =
  | { kind: "download"; href: string }
  | { kind: "compat"; href: string; message: string; delivered: Selection }
  | { kind: "request" };

// 代理店向け施工内容コンフィギュレータ。
// ステージ＋バブリング＋OP(O2 等)を選ぶと、判定中(loading)表示のあと
// 「DL可能」か「リクエスト」を出す。全通りを1行ずつ並べない。
export function TuningConfigurator({
  recordId,
  stages,
  showPops,
  optionTags,
  limiterDisabled = false,
}: {
  recordId: string;
  stages: Stage[];
  showPops: boolean;
  optionTags: string[];
  limiterDisabled?: boolean;
}) {
  const [stage, setStage] = useState(stages[0]?.value ?? "");
  const [popsMode, setPopsMode] = useState<"none" | "all" | "sport">("none");
  const [selected, setSelected] = useState<string[]>([]);
  const pops = popsMode !== "none";
  const popsSport = popsMode === "sport";
  const [resolving, startResolve] = useTransition();
  const [result, setResult] = useState<Resolved | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [requesting, startRequest] = useTransition();
  const [requested, setRequested] = useState(false);
  const [agreed, setAgreed] = useState(false);

  // バブリング以外のオプション(=selected の全て)は有料OP
  const hasPaid = selected.length > 0;

  // 選択が変わるたびに判定（loading→DL可能 or リクエスト）
  useEffect(() => {
    setResult(null);
    setError(null);
    setRequested(false);
    setAgreed(false); // 構成が変わったら同意もリセット
    startResolve(async () => {
      const r = await resolveTuning(recordId, { stage, pops, popsSport, optionTags: selected });
      if ("error" in r) setError(r.error);
      else setResult(r);
    });
    // selected は配列だが toggle で新規生成するため依存に含めて良い
  }, [recordId, stage, popsMode, selected]);

  const toggleOpt = (t: string) =>
    setSelected((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));

  const onRequest = () =>
    startRequest(async () => {
      const r = await requestTuning(
        recordId,
        { stage, pops, popsSport, optionTags: selected },
        agreed,
      );
      if (r.error) setError(r.error);
      else setRequested(true);
    });

  return (
    <div className="space-y-4">
      {/* ステージ選択 */}
      {stages.length > 0 && (
        <div>
          <div className="mb-1.5 text-xs font-semibold text-ink-soft">ステージ</div>
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
      )}

      {/* バブリング（なし/全モード/スポーツ） */}
      {showPops && (
        <div>
          <div className="mb-1.5 text-xs font-semibold text-ink-soft">バブリング</div>
          <div className="flex flex-wrap gap-2">
            {([
              ["none", "なし"],
              ["all", "全モード"],
              ["sport", "スポーツ"],
            ] as const).map(([v, label]) => (
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
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* オプション（O2 等） */}
      <div>
        <div className="mb-1.5 text-xs font-semibold text-ink-soft">オプション</div>
        <div className="flex flex-wrap gap-2">
          {optionTags.map((t) => {
            const limOff = t === SPEED_LIMITER_TAG && limiterDisabled;
            const on = selected.includes(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => toggleOpt(t)}
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold transition ${
                  on
                    ? "border-gold-400 bg-gold-500 text-white"
                    : "border-line bg-white text-ink-soft hover:bg-surface-2"
                }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 rounded-full border ${
                    on ? "border-white bg-white" : "border-line"
                  }`}
                />
                {t}
                {limOff && (
                  <span className={`text-[11px] font-semibold ${on ? "text-white/90" : "text-rose-600"}`}>
                    （不可）
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* 判定結果 */}
      <div className="space-y-3 border-t border-line pt-3">
        {/* 状態バッジ（即DL=Automatic 緑 / リクエスト=赤）＋選択内容のサマリ */}
        {!resolving && !error && result && (
          <div className="flex flex-wrap items-center gap-2">
            {result.kind === "request" ? (
              <span className="inline-flex items-center gap-1 rounded-lg bg-red-500 px-3 py-1 text-xs font-extrabold tracking-wide text-white">
                リクエストが必要
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-lg bg-green-500 px-3 py-1 text-xs font-extrabold tracking-wide text-white">
                ⚡ AUTOMATIC{result.kind === "compat" ? "（互換版）" : ""}
              </span>
            )}
            <span className="text-sm font-semibold text-ink">
              {tuningContentLabel(stage, pops, selected, popsSport)}
            </span>
          </div>
        )}
        {resolving ? (
          <div className="flex items-center gap-2 text-sm text-ink-soft">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-gold-300 border-t-gold-600" />
            判定中…
          </div>
        ) : error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : result?.kind === "download" ? (
          <DownloadConsent
            recordId={recordId}
            selection={{ stage, pops, popsSport, optionTags: selected }}
            href={result.href}
          />
        ) : result?.kind === "compat" ? (
          <div className="space-y-2">
            <div className="rounded-lg border border-sky-300 bg-sky-50 p-3">
              <p className="text-xs font-semibold text-sky-800">互換ファイルがあります</p>
              <p className="mt-1 text-xs text-sky-700">{result.message}</p>
            </div>
            {/* 課金は実際に渡す内容(delivered)で判定 */}
            <DownloadConsent
              recordId={recordId}
              selection={result.delivered}
              href={result.href}
            />
          </div>
        ) : result?.kind === "request" ? (
          requested ? (
            <span className="text-sm font-semibold text-ink-soft">リクエスト済み</span>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-ink-soft">この構成は未提供です。本店へ作成を依頼できます。</p>
              {/* 有料OP（バブリング以外）が含まれるときは忠告＋同意を必須にする */}
              {hasPaid && (
                <div className="rounded-lg border border-amber-300 bg-amber-50 p-3">
                  <p className="text-xs font-semibold text-amber-800">
                    有料オプションが含まれます
                  </p>
                  <p className="mt-1 text-xs text-amber-700">
                    バブリング以外のオプション（{selected.join("・")}）は<b>有料</b>です。
                    別途料金が発生することにご同意のうえリクエストしてください。
                  </p>
                  <label className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-amber-900">
                    <input
                      type="checkbox"
                      checked={agreed}
                      onChange={(e) => setAgreed(e.target.checked)}
                      className="h-4 w-4 accent-amber-600"
                    />
                    有料オプションの料金発生に同意します
                  </label>
                </div>
              )}
              <button
                type="button"
                disabled={requesting || (hasPaid && !agreed)}
                onClick={onRequest}
                className="inline-flex items-center rounded-lg border border-gold-300 bg-white px-4 py-2 text-sm font-semibold text-gold-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {requesting ? "送信中…" : "リクエスト"}
              </button>
            </div>
          )
        ) : null}
      </div>
    </div>
  );
}
