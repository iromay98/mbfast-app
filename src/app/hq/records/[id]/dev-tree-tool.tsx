"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addDevNode,
  deleteDevNode,
  setDevCurrent,
  setDevMode,
  updateDevNode,
} from "@/lib/actions/dev-tree";

export type DevNodeRow = {
  id: string;
  label: string;
  note: string | null;
  fileName: string | null;
  hasFile: boolean;
  okNextId: string | null;
  ngNextId: string | null;
};
export type DevTrialRow = {
  id: string;
  nodeLabel: string;
  result: string;
  comment: string | null;
  createdAtLabel: string;
};

// 本部: 実車開発モードのツリー構築・進行管理
export function DevTreeTool({
  recordId,
  devMode,
  currentNodeId,
  nodes,
  trials,
}: {
  recordId: string;
  devMode: boolean;
  currentNodeId: string | null;
  nodes: DevNodeRow[];
  trials: DevTrialRow[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const run = (fn: () => Promise<{ ok?: true; error?: string }>) =>
    start(async () => {
      const r = await fn();
      setMsg(r.error ?? null);
      router.refresh();
    });

  const nodeName = (id: string | null) => nodes.find((n) => n.id === id)?.label ?? "—";

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <label className="flex items-center gap-1.5 text-xs font-semibold">
          <input
            type="checkbox"
            checked={devMode}
            disabled={pending}
            onChange={(e) => run(() => setDevMode(recordId, e.target.checked))}
          />
          開発モードON（代理店に開発カードを表示）
        </label>
        {msg && <span className="text-xs text-red-600">{msg}</span>}
      </div>

      {/* ノード一覧 */}
      {nodes.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-left text-[11px] text-ink-soft">
              <tr>
                <th className="py-1">ノード</th>
                <th>ファイル</th>
                <th>✅ 良ければ次</th>
                <th>❌ ダメなら次</th>
                <th></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {nodes.map((n) => (
                <tr key={n.id} className={n.id === currentNodeId ? "bg-gold-50/60" : ""}>
                  <td className="py-1.5">
                    <span className="font-semibold">{n.label}</span>
                    {n.id === currentNodeId && (
                      <span className="ml-1 rounded bg-gold-500 px-1 py-0.5 text-[9px] font-bold text-white">現在</span>
                    )}
                    {n.note && <div className="text-[11px] text-ink-soft">{n.note}</div>}
                  </td>
                  <td className="max-w-[10rem] truncate font-mono text-[11px]">
                    {n.hasFile ? (
                      <a href={`/api/records/${recordId}/dev-file?raw=1`} className={n.id === currentNodeId ? "text-sky-700 hover:underline" : "text-ink-soft"} title={n.fileName ?? ""}>
                        {n.fileName ?? "あり"}
                      </a>
                    ) : (
                      <span className="text-red-600">未添付</span>
                    )}
                  </td>
                  <NextSelect nodes={nodes} selfId={n.id} value={n.okNextId} pending={pending} onChange={(v) => run(() => updateDevNode(n.id, { okNextId: v }))} />
                  <NextSelect nodes={nodes} selfId={n.id} value={n.ngNextId} pending={pending} onChange={(v) => run(() => updateDevNode(n.id, { ngNextId: v }))} />
                  <td className="whitespace-nowrap text-right">
                    {n.id !== currentNodeId && (
                      <button type="button" disabled={pending} onClick={() => run(() => setDevCurrent(recordId, n.id))} className="mr-2 text-[11px] text-sky-700 hover:underline">
                        ここから
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={pending}
                      onClick={() => {
                        if (window.confirm(`「${n.label}」を削除しますか？`)) run(() => deleteDevNode(n.id));
                      }}
                      className="text-[11px] text-red-600 hover:underline"
                    >
                      削除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ノード追加 */}
      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          run(async () => {
            const r = await addDevNode(recordId, fd);
            if (!r.error) formRef.current?.reset();
            return r;
          });
        }}
        className="grid gap-2 rounded-lg border border-line bg-surface-2 p-2 md:grid-cols-4"
      >
        <input name="label" required placeholder="ラベル（例: ②点火控えめ）" className="rounded border border-line bg-surface px-2 py-1 text-xs" />
        <input name="note" placeholder="メモ（何を変えたか・見てほしい点）" className="rounded border border-line bg-surface px-2 py-1 text-xs md:col-span-2" />
        <div className="flex items-center gap-2">
          <input name="file" type="file" className="w-full text-[11px]" />
          <button type="submit" disabled={pending} className="whitespace-nowrap rounded-lg bg-gold-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
            追加
          </button>
        </div>
      </form>

      {/* 試行ログ */}
      {trials.length > 0 && (
        <div>
          <h4 className="mb-1 text-[11px] font-semibold text-ink-soft">試行ログ</h4>
          <div className="space-y-0.5 text-[11px]">
            {trials.map((t) => (
              <div key={t.id}>
                <span className="text-ink-soft">{t.createdAtLabel}</span>{" "}
                <span className="font-semibold">{t.nodeLabel}</span>{" "}
                {t.result === "ok" ? "✅ 良好" : "❌ ダメ"}
                {t.comment && <span className="text-ink-soft"> — {t.comment}</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-[11px] text-ink-soft">
        代理店には常に「現在」ノードのslaveだけが配信されます（先のノードは見えません）。分岐先が未設定のまま終端に達すると本部に通知が来ます。矢印の先の内容: {nodes.map((n) => `${n.label}[✅→${nodeName(n.okNextId)} / ❌→${nodeName(n.ngNextId)}]`).join("　")}
      </p>
    </div>
  );
}

function NextSelect({
  nodes,
  selfId,
  value,
  pending,
  onChange,
}: {
  nodes: DevNodeRow[];
  selfId: string;
  value: string | null;
  pending: boolean;
  onChange: (v: string | null) => void;
}) {
  return (
    <td>
      <select
        value={value ?? ""}
        disabled={pending}
        onChange={(e) => onChange(e.target.value || null)}
        className="max-w-[9rem] rounded border border-line bg-surface px-1 py-0.5 text-[11px]"
      >
        <option value="">（終端）</option>
        {nodes
          .filter((n) => n.id !== selfId)
          .map((n) => (
            <option key={n.id} value={n.id}>
              {n.label}
            </option>
          ))}
      </select>
    </td>
  );
}
