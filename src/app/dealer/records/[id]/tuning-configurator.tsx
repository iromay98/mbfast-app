"use client";

import { useEffect, useState, useTransition } from "react";
import { resolveTuning, requestTuning } from "@/lib/actions/requests";

type Stage = { value: string; label: string };
type Resolved = { kind: "download"; href: string } | { kind: "request" };

// 代理店向け施工内容コンフィギュレータ。
// ステージ＋バブリング＋OP(O2 等)を選ぶと、判定中(loading)表示のあと
// 「DL可能」か「リクエスト」を出す。全通りを1行ずつ並べない。
export function TuningConfigurator({
  recordId,
  stages,
  showPops,
  optionTags,
}: {
  recordId: string;
  stages: Stage[];
  showPops: boolean;
  optionTags: string[];
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

      {/* 判定結果 */}
      <div className="border-t border-line pt-3">
        {resolving ? (
          <div className="flex items-center gap-2 text-sm text-ink-soft">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-gold-300 border-t-gold-600" />
            判定中…
          </div>
        ) : error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : result?.kind === "download" ? (
          <a
            href={result.href}
            download
            className="inline-flex items-center rounded-lg bg-gold-500 px-4 py-2 text-sm font-semibold text-white"
          >
            DL可能 — .slave をダウンロード
          </a>
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
