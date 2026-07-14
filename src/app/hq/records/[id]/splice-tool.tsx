"use client";

import { useState, useTransition } from "react";
import { generateSpliceCandidate, type SpliceReport } from "@/lib/actions/splice";

export type SpliceSource = {
  variantId: string;
  label: string; // 内容ラベル（Stage1・バブリング 等）
  vehicle: string; // 車種(世代) grade
  tool: string;
  method: string;
  cal: string;
  hasOri: boolean; // カタログに純正(ori)があるか＝差分を取れるか
};

// 別ツール準用「ニコイチ」候補生成（本店専用）。
// 元バリエーションのキャリブ差分を、この車の ori に転写した候補を作る。自動配布はしない。
export function SpliceTool({
  recordId,
  sources,
}: {
  recordId: string;
  sources: SpliceSource[];
}) {
  const [sel, setSel] = useState(sources[0]?.variantId ?? "");
  const [pending, start] = useTransition();
  const [report, setReport] = useState<SpliceReport | null>(null);

  if (sources.length === 0) {
    return (
      <p className="text-xs text-ink-soft">
        準用できる候補（同一車種で純正+チューン済みが揃った別バリエーション）がありません。
      </p>
    );
  }

  const run = () =>
    start(async () => {
      setReport(null);
      const r = await generateSpliceCandidate(recordId, sel);
      setReport(r);
    });

  return (
    <div className="space-y-2">
      <p className="text-xs text-ink-soft">
        別ツール/Methodで作った既存チューンの<b>キャリブレーションエリアだけ</b>を、この車の
        <b>ori</b>に転写した候補を生成します。<b>自動配布・自動slave化はしません</b>。
        生成後に中身を確認し、問題なければチャットの「slaveに変換」等でお使いください。
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select
          value={sel}
          onChange={(e) => setSel(e.target.value)}
          className="min-w-0 flex-1 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
        >
          {sources.map((s) => (
            <option key={s.variantId} value={s.variantId} disabled={!s.hasOri}>
              {s.vehicle}｜{s.label}｜{s.tool}
              {s.method ? `_${s.method}` : ""}
              {s.cal ? `｜Cal ${s.cal}` : ""}
              {s.hasOri ? "" : "（純正なし・不可）"}
            </option>
          ))}
        </select>
        <button
          type="button"
          disabled={pending || !sel}
          onClick={run}
          className="rounded-lg bg-sky-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
        >
          {pending ? "生成中…" : "ニコイチ候補を生成"}
        </button>
      </div>

      {report && !report.ok && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          生成できませんでした：{report.error}
        </p>
      )}
      {report && report.ok && (
        <div className="rounded-lg border border-sky-300 bg-sky-50 p-3 text-sm">
          <p className="font-semibold text-sky-800">✅ 候補を生成しました（要確認）</p>
          <ul className="mt-1 space-y-0.5 text-xs text-sky-800">
            <li>
              転写: {report.rangeCount} 箇所・計 {report.changedBytes} バイト（
              {report.sameLayout ? "同一レイアウト" : "別レイアウト・アンカー探索"}）
            </li>
            <li>出力サイズ: {report.outSize?.toLocaleString()} バイト（代理店oriと同じ）</li>
            <li className="font-semibold text-rose-600">
              ※ チェックサムは自動補正していません。焼く前に必ず検証してください。
            </li>
          </ul>
          <a
            href={`/api/records/${recordId}/splice?key=${encodeURIComponent(report.candidateKey ?? "")}`}
            download
            className="mt-2 inline-block rounded-lg border border-sky-400 bg-white px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-50"
          >
            ⬇ 候補bin をダウンロードして確認
          </a>
        </div>
      )}
    </div>
  );
}
