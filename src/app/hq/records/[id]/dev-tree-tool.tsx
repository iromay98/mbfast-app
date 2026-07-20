"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  addDevNode,
  addDevNodeFromMessage,
  addDevNodeFromVersion,
  deleteDevNode,
  setDevCurrent,
  setDevFreeChoice,
  setDevMode,
  updateDevNode,
} from "@/lib/actions/dev-tree";
import { DevTreeView } from "@/components/dev-tree-view";

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
// 過去のバリエーション版（この車に適合するBaseFile配下）
export type DevSourceRow = { versionId: string; label: string };
// 案件のやり取り（チャット）に添付されたファイル
export type DevMsgSourceRow = { messageId: string; label: string };

// 本部: 実車開発モードのツリー構築・進行管理
export function DevTreeTool({
  recordId,
  devMode,
  devFreeChoice,
  currentNodeId,
  nodes,
  trials,
  sources,
  msgSources,
}: {
  recordId: string;
  devMode: boolean;
  devFreeChoice: boolean;
  currentNodeId: string | null;
  nodes: DevNodeRow[];
  trials: DevTrialRow[];
  sources: DevSourceRow[];
  msgSources: DevMsgSourceRow[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const run = (fn: () => Promise<{ ok?: true; error?: string }>) =>
    start(async () => {
      const r = await fn();
      setMsg(r.error ?? null);
      router.refresh();
    });

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
        <label className="flex items-center gap-1.5 text-xs" title="ONにすると代理店がツリー内のノードを自分で選んで切り替えられます（報告での自動進行も引き続き動きます）">
          <input
            type="checkbox"
            checked={devFreeChoice}
            disabled={pending || !devMode}
            onChange={(e) => run(() => setDevFreeChoice(recordId, e.target.checked))}
          />
          代理店のノード選択を許可
        </label>
        {msg && <span className="text-xs text-red-600">{msg}</span>}
      </div>

      {/* ツリー表示 */}
      {nodes.length > 0 && <DevTreeView nodes={nodes} currentNodeId={currentNodeId} showFileBadge />}

      {/* ノード一覧（編集） */}
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
                    <div className="flex items-center gap-1">
                      <EditCell
                        value={n.label}
                        bold
                        placeholder="ラベル"
                        onSave={(v) => run(() => updateDevNode(n.id, { label: v }))}
                      />
                      {n.id === currentNodeId && (
                        <span className="rounded bg-gold-500 px-1 py-0.5 text-[9px] font-bold text-white">現在</span>
                      )}
                    </div>
                    <EditCell
                      value={n.note ?? ""}
                      placeholder="メモ（クリックで編集）"
                      soft
                      onSave={(v) => run(() => updateDevNode(n.id, { note: v }))}
                    />
                  </td>
                  <td className="max-w-[10rem] truncate font-mono text-[11px]">
                    {n.hasFile ? (
                      <span title={n.fileName ?? ""}>{n.fileName ?? "あり"}</span>
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

      <AddNodeForm recordId={recordId} sources={sources} msgSources={msgSources} pending={pending} onRun={run} />

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
        代理店には常に「現在」ノードのslaveだけが配信されます（先のノードは見えません）。分岐先が未設定のまま終端に達すると本部に通知が来ます。
      </p>
    </div>
  );
}

// ── ノード追加（新規アップ or 過去のバリエーション版から） ──
function AddNodeForm({
  recordId,
  sources,
  msgSources,
  pending,
  onRun,
}: {
  recordId: string;
  sources: DevSourceRow[];
  msgSources: DevMsgSourceRow[];
  pending: boolean;
  onRun: (fn: () => Promise<{ ok?: true; error?: string }>) => void;
}) {
  const [mode, setMode] = useState<"upload" | "existing" | "chat">("upload");
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <div className="rounded-lg border border-line bg-surface-2 p-2">
      <div className="mb-2 flex gap-1">
        <ModeBtn on={mode === "upload"} onClick={() => setMode("upload")}>
          新しいファイルをアップ
        </ModeBtn>
        <ModeBtn on={mode === "existing"} onClick={() => setMode("existing")} disabled={sources.length === 0}>
          過去のファイルから選ぶ{sources.length === 0 ? "（候補なし）" : `（${sources.length}件）`}
        </ModeBtn>
        <ModeBtn on={mode === "chat"} onClick={() => setMode("chat")} disabled={msgSources.length === 0}>
          やり取りのファイルから{msgSources.length === 0 ? "（候補なし）" : `（${msgSources.length}件）`}
        </ModeBtn>
      </div>

      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          onRun(async () => {
            const r =
              mode === "upload"
                ? await addDevNode(recordId, fd)
                : mode === "existing"
                  ? await addDevNodeFromVersion(
                      recordId,
                      String(fd.get("versionId") ?? ""),
                      String(fd.get("label") ?? ""),
                      String(fd.get("note") ?? ""),
                    )
                  : await addDevNodeFromMessage(
                      recordId,
                      String(fd.get("messageId") ?? ""),
                      String(fd.get("label") ?? ""),
                      String(fd.get("note") ?? ""),
                    );
            if (!r.error) formRef.current?.reset();
            return r;
          });
        }}
        className="grid gap-2 md:grid-cols-4"
      >
        {mode === "existing" && (
          <select name="versionId" required className="rounded border border-line bg-surface px-2 py-1 text-xs md:col-span-2">
            {sources.map((s) => (
              <option key={s.versionId} value={s.versionId}>
                {s.label}
              </option>
            ))}
          </select>
        )}
        {mode === "chat" && (
          <select name="messageId" required className="rounded border border-line bg-surface px-2 py-1 text-xs md:col-span-2">
            {msgSources.map((m) => (
              <option key={m.messageId} value={m.messageId}>
                {m.label}
              </option>
            ))}
          </select>
        )}
        <input
          name="label"
          required={mode === "upload"}
          placeholder={mode === "upload" ? "ラベル（例: ②点火控えめ）" : "ラベル（空なら自動）"}
          className="rounded border border-line bg-surface px-2 py-1 text-xs"
        />
        <input
          name="note"
          placeholder="メモ（何を変えたか・見てほしい点）"
          className={`rounded border border-line bg-surface px-2 py-1 text-xs ${mode === "upload" ? "md:col-span-2" : ""}`}
        />
        {mode === "upload" ? (
          <div className="flex items-center gap-2">
            <input name="file" type="file" className="w-full text-[11px]" />
            <SubmitBtn pending={pending} />
          </div>
        ) : (
          <div className="md:col-span-4 flex justify-end">
            <SubmitBtn pending={pending} />
          </div>
        )}
      </form>
    </div>
  );
}

function ModeBtn({ on, onClick, disabled, children }: { on: boolean; onClick: () => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold ${
        on ? "bg-gold-500 text-white" : "border border-line bg-surface text-ink-soft"
      } disabled:opacity-40`}
    >
      {children}
    </button>
  );
}

function SubmitBtn({ pending }: { pending: boolean }) {
  return (
    <button type="submit" disabled={pending} className="whitespace-nowrap rounded-lg bg-gold-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50">
      追加
    </button>
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

// クリックで編集・blur/Enterで保存（Escで取消）
function EditCell({
  value,
  onSave,
  bold,
  soft,
  placeholder,
}: {
  value: string;
  onSave: (v: string) => void;
  bold?: boolean;
  soft?: boolean;
  placeholder?: string;
}) {
  const [v, setV] = useState(value);
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    setV(value);
  }
  return (
    <input
      value={v}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (v.trim() !== value.trim()) onSave(v.trim());
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setV(value);
          e.currentTarget.blur();
        }
      }}
      className={`w-full min-w-[8rem] rounded border border-transparent bg-transparent px-1 py-0.5 hover:border-line focus:border-gold-400 focus:bg-white focus:outline-none ${
        bold ? "text-xs font-semibold" : ""
      } ${soft ? "text-[11px] text-ink-soft" : "text-xs"}`}
    />
  );
}
