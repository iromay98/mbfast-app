"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { addEcuSide, addEcuSideFromRecord, removeEcuSide, setPrimarySide } from "@/lib/actions/ecu-sides";

export type EcuSideRow = {
  id: string;
  side: string;
  ecuType: string | null;
  backupSupported: boolean | null;
};
export type MergeCandidate = { id: string; label: string };

// 左右ECU車（V12等）: 2基目のECUを同じ記録にまとめる管理カード。
// cal(.slave)は左右共通のまま。bak系（純正bak・チャットのbak変換）だけ側ごとに分かれる。
export function EcuSidesCard({
  recordId,
  primarySide,
  sides,
  isHQ,
  mergeCandidates = [],
}: {
  recordId: string;
  primarySide: string;
  sides: EcuSideRow[];
  isHQ: boolean;
  mergeCandidates?: MergeCandidate[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(sides.length > 0);
  const [msg, setMsg] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  const run = (fn: () => Promise<{ ok?: true; error?: string }>) =>
    start(async () => {
      const r = await fn();
      setMsg(r.error ?? null);
      router.refresh();
    });

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-xs text-ink-soft underline underline-offset-2 hover:text-ink">
        左右ECU車（2基目のECU）の設定を開く
      </button>
    );
  }

  const otherSide = primarySide === "左" ? "右" : "左";

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h4 className="text-xs font-semibold">左右ECU（2基のECUがある車）</h4>
        {sides.length === 0 && (
          <button type="button" onClick={() => setOpen(false)} className="ml-auto text-[11px] text-ink-soft hover:underline">
            閉じる
          </button>
        )}
      </div>
      <p className="text-[11px] text-ink-soft">
        チューニング(.slave)は左右共通のまま。<b>bak（フルバックアップ）だけ側ごと</b>に作り分けます。
      </p>

      {/* 登録済み側の一覧 */}
      <div className="space-y-1 text-xs">
        <div className="flex items-center gap-2">
          <span className="rounded bg-ink px-1.5 py-0.5 text-[10px] font-bold text-white">{primarySide}</span>
          <span>メイン（この記録のスレーブ）</span>
          {isHQ && sides.length === 0 && (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => setPrimarySide(recordId, otherSide))}
              className="text-[11px] text-sky-700 hover:underline"
            >
              ラベルを「{otherSide}」に変更
            </button>
          )}
        </div>
        {sides.map((s) => (
          <div key={s.id} className="flex items-center gap-2">
            <span className="rounded bg-ink px-1.5 py-0.5 text-[10px] font-bold text-white">{s.side}</span>
            <span>
              {s.ecuType ?? "ECU"}
              {s.backupSupported === false && <span className="ml-1 text-red-600">（bak非対応）</span>}
            </span>
            {isHQ && (
              <button
                type="button"
                disabled={pending}
                onClick={() => {
                  if (window.confirm(`「${s.side}」側を削除しますか？`)) run(() => removeEcuSide(s.id));
                }}
                className="text-[11px] text-red-600 hover:underline"
              >
                削除
              </button>
            )}
          </div>
        ))}
      </div>

      {/* 2基目の追加（スレーブをアップ） */}
      {sides.length === 0 && (
        <form
          ref={formRef}
          onSubmit={(e) => {
            e.preventDefault();
            const fd = new FormData(e.currentTarget);
            run(async () => {
              const r = await addEcuSide(recordId, fd);
              if (!r.error) formRef.current?.reset();
              return r;
            });
          }}
          className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface-2 p-2 text-xs"
        >
          <select name="side" defaultValue={otherSide} className="rounded border border-line bg-surface px-2 py-1">
            <option value="左">左</option>
            <option value="右">右</option>
          </select>
          <input name="slaveFile" type="file" required className="text-[11px]" />
          <button type="submit" disabled={pending} className="rounded-lg bg-gold-500 px-3 py-1.5 font-semibold text-white disabled:opacity-50">
            {pending ? "復号中…" : "2基目のスレーブを追加"}
          </button>
          <span className="w-full text-[10px] text-ink-soft">
            もう片方のECUから読んだスレーブをアップしてください（復号して車両情報を確認します）。
          </span>
        </form>
      )}

      {/* 既存の別記録を統合（本店のみ・過去に左右で別記録になっているペア用） */}
      {isHQ && sides.length === 0 && mergeCandidates.length > 0 && (
        <MergeForm recordId={recordId} otherSide={otherSide} candidates={mergeCandidates} pending={pending} onRun={run} />
      )}

      {msg && <p className="text-xs text-red-600">{msg}</p>}
    </div>
  );
}

function MergeForm({
  recordId,
  otherSide,
  candidates,
  pending,
  onRun,
}: {
  recordId: string;
  otherSide: string;
  candidates: MergeCandidate[];
  pending: boolean;
  onRun: (fn: () => Promise<{ ok?: true; error?: string }>) => void;
}) {
  const [otherId, setOtherId] = useState("");
  const [side, setSide] = useState(otherSide);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed border-line p-2 text-xs">
      <span className="text-[11px] text-ink-soft">または過去の別記録を統合:</span>
      <select value={otherId} onChange={(e) => setOtherId(e.target.value)} className="max-w-[16rem] rounded border border-line bg-surface px-2 py-1">
        <option value="">記録を選択</option>
        {candidates.map((c) => (
          <option key={c.id} value={c.id}>
            {c.label}
          </option>
        ))}
      </select>
      <select value={side} onChange={(e) => setSide(e.target.value)} className="rounded border border-line bg-surface px-2 py-1">
        <option value="左">左</option>
        <option value="右">右</option>
      </select>
      <button
        type="button"
        disabled={pending || !otherId}
        onClick={() => onRun(() => addEcuSideFromRecord(recordId, otherId, side))}
        className="rounded-lg border border-line px-3 py-1.5 font-semibold text-ink-soft hover:bg-surface-2 disabled:opacity-50"
      >
        統合する
      </button>
      <span className="w-full text-[10px] text-ink-soft">
        統合後、元の記録は不要なら手動で削除してください（統合はスレーブをコピーするので削除しても壊れません）。
      </span>
    </div>
  );
}
