"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { SlaveDownloadButton } from "@/components/slave-download-button";
import { reportDevResult, selectDevNode } from "@/lib/actions/dev-tree";
import { DevTreeView, type TreeNode } from "@/components/dev-tree-view";

// 代理店: 実車開発モードのカード。現在ノードのDL＋「良い/ダメ」報告で次のファイルが開放される。
export function DevReportCard({
  recordId,
  nodeLabel,
  nodeNote,
  hasFile,
  isEnd, // 両方の分岐が未設定（＝これが最後の候補）
  freeChoice = false,
  nodeOptions = [],
  currentNodeId = null,
  treeNodes = [],
}: {
  recordId: string;
  nodeLabel: string;
  nodeNote: string | null;
  hasFile: boolean;
  isEnd: boolean;
  // 本部が許可した場合のみ: ツリー内のノードを自分で選んで切り替えられる
  freeChoice?: boolean;
  nodeOptions?: { id: string; label: string }[];
  currentNodeId?: string | null;
  // ツリー表示用（ラベルと分岐のみ。メモは含めない）
  treeNodes?: TreeNode[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [comment, setComment] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const report = (result: "ok" | "ng") => {
    if (!window.confirm(`「${nodeLabel}」を${result === "ok" ? "✅ 良好" : "❌ ダメ"}として報告します。よろしいですか？`)) return;
    start(async () => {
      const r = await reportDevResult(recordId, result, comment);
      if (r.error) {
        setMsg(r.error);
        return;
      }
      setComment("");
      setMsg(
        r.nextLabel
          ? `報告しました。次の候補「${r.nextLabel}」がダウンロードできます。`
          : "報告しました。次の候補はありません。本部からの連絡をお待ちください。",
      );
      router.refresh();
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded bg-violet-600 px-1.5 py-0.5 text-[10px] font-bold text-white">開発中</span>
        <span className="text-sm font-semibold">{nodeLabel}</span>
      </div>
      {treeNodes.length > 0 && <DevTreeView nodes={treeNodes} currentNodeId={currentNodeId} />}

      {freeChoice && nodeOptions.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-line p-2">
          <span className="text-[11px] text-ink-soft">別の候補に切り替え（本部が許可済み）:</span>
          <select
            value={currentNodeId ?? ""}
            disabled={pending}
            onChange={(e) => {
              const id = e.target.value;
              if (!id || id === currentNodeId) return;
              start(async () => {
                const r = await selectDevNode(recordId, id);
                setMsg(r.error ?? null);
                router.refresh();
              });
            }}
            className="rounded border border-line bg-surface px-2 py-1 text-xs"
          >
            {nodeOptions.map((n) => (
              <option key={n.id} value={n.id}>
                {n.label}
              </option>
            ))}
          </select>
        </div>
      )}

      {hasFile ? (
        <SlaveDownloadButton
          href={`/api/records/${recordId}/dev-file`}
          label={`「${nodeLabel}」をダウンロード (.slave)`}
        />
      ) : (
        <p className="text-xs text-red-600">このノードにはファイルがまだ添付されていません（本部にお問い合わせください）。</p>
      )}

      <div className="rounded-lg border border-line bg-surface-2 p-2">
        <p className="mb-1 text-[11px] text-ink-soft">
          焼いて試したら結果を報告してください。{isEnd ? "これが最後の候補です。" : "報告すると次の候補ファイルが開放されます。"}
        </p>
        <textarea
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          rows={2}
          placeholder="症状・様子など（任意。例: 高回転でノック音あり / アイドリング安定）"
          className="mb-2 w-full rounded border border-line bg-surface px-2 py-1 text-xs"
        />
        <div className="flex gap-2">
          <button
            type="button"
            disabled={pending}
            onClick={() => report("ok")}
            className="flex-1 rounded-lg bg-green-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            ✅ 良好だった
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => report("ng")}
            className="flex-1 rounded-lg bg-red-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50"
          >
            ❌ ダメだった
          </button>
        </div>
        {msg && <p className="mt-2 text-xs font-semibold">{msg}</p>}
      </div>
    </div>
  );
}
