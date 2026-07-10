"use client";

import { useRef, useState } from "react";

export type StockVariantRow = {
  id: string;
  stage: string;
  popsAndBangs: boolean;
  popsSport: boolean;
  optionTags: string[];
  status: string;
  fileName: string | null;
  label: string;
};

const STATUS = {
  AVAILABLE: { label: "配布可", cls: "bg-green-100 text-green-700" },
  DRAFT: { label: "下書き", cls: "bg-amber-100 text-amber-700" },
  DISABLED: { label: "無効", cls: "bg-surface-2 text-ink-soft" },
} as const;

// 未整備ストックの「登録済みバリエーション」テーブル。
// カタログの編集行と同等に、各オプションの有無・状態・ファイルを一覧し、差し替え/削除できる。
export function RegisteredVariants({
  variants,
  optionCols,
  showPops,
  busy,
  canSlave = false,
  onReplace,
  onDelete,
}: {
  variants: StockVariantRow[];
  optionCols: string[]; // 表示するオプション列（NOx/DTC/O2/スピードリミッターカット 等）
  showPops: boolean;
  busy?: boolean;
  canSlave?: boolean; // 取込元の車固有IDが揃い .slave 化できる（純正単位）
  onReplace: (id: string, file: File) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="overflow-hidden rounded-lg border border-line">
      <div className="border-b border-line bg-surface-2 px-3 py-1.5 text-xs font-semibold text-ink-soft">
        登録済みバリエーション（{variants.length}）
      </div>
      {variants.length === 0 ? (
        <p className="p-3 text-xs text-ink-soft">まだバリエーションはありません。</p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-ink-soft">
              <th className="px-3 py-2 font-semibold">ステージ</th>
              {showPops && <th className="px-2 py-2 font-semibold">バブリング</th>}
              {optionCols.map((t) => (
                <th key={t} className="px-2 py-2 text-center font-semibold">
                  {t}
                </th>
              ))}
              <th className="px-2 py-2 font-semibold">状態</th>
              <th className="px-3 py-2 font-semibold">ファイル / 差し替え</th>
            </tr>
          </thead>
          <tbody>
            {variants.map((v) => (
              <Row
                key={v.id}
                v={v}
                optionCols={optionCols}
                showPops={showPops}
                busy={busy}
                canSlave={canSlave}
                onReplace={onReplace}
                onDelete={onDelete}
              />
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function Row({
  v,
  optionCols,
  showPops,
  busy,
  canSlave,
  onReplace,
  onDelete,
}: {
  v: StockVariantRow;
  optionCols: string[];
  showPops: boolean;
  busy?: boolean;
  canSlave?: boolean;
  onReplace: (id: string, file: File) => void;
  onDelete: (id: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);
  const st = STATUS[v.status as keyof typeof STATUS] ?? STATUS.DRAFT;
  const pops = v.popsAndBangs ? (v.popsSport ? "スポーツ" : "全モード") : "−";
  const dim = v.status === "DISABLED" ? "opacity-60" : "";
  return (
    <tr className={`border-b border-line last:border-0 align-middle ${dim}`}>
      <td className="px-3 py-2 font-semibold text-ink">{v.stage || "チューニングなし"}</td>
      {showPops && <td className="px-2 py-2 text-ink-soft">{pops}</td>}
      {optionCols.map((t) => (
        <td key={t} className="px-2 py-2 text-center">
          <input
            type="checkbox"
            checked={v.optionTags.includes(t)}
            readOnly
            disabled
            className="h-4 w-4 cursor-not-allowed accent-gold-500"
          />
        </td>
      ))}
      <td className="px-2 py-2">
        <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${st.cls}`}>{st.label}</span>
      </td>
      <td className="px-3 py-2">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files?.[0];
            if (f) onReplace(v.id, f);
          }}
          className={`rounded ${drag ? "bg-gold-50 ring-1 ring-gold-300" : ""}`}
        >
          {v.fileName ? (
            <a
              href={`/api/catalog/variants/${v.id}/file`}
              className="block max-w-[280px] truncate font-mono text-[12px] text-gold-700 underline"
              title={v.fileName}
            >
              {v.fileName}
            </a>
          ) : (
            <span className="text-[12px] text-ink-soft">未登録</span>
          )}
          <div className="mt-1 flex items-center gap-2">
            {/* 欲しいファイルをその場でDL（.bin=生チューニング / .slave=取込元の車で再暗号化） */}
            {v.fileName && (
              <a
                href={`/api/catalog/variants/${v.id}/file`}
                download
                title="チューニング済みの生bin"
                className="rounded border border-line px-2.5 py-1 text-xs font-semibold text-ink-soft hover:bg-surface-2"
              >
                .bin
              </a>
            )}
            {v.fileName &&
              (canSlave ? (
                <a
                  href={`/api/catalog/variants/${v.id}/slave`}
                  download
                  title="取込元の車両で再暗号化した焼ける .slave"
                  className="rounded border border-gold-300 px-2.5 py-1 text-xs font-semibold text-gold-700 hover:bg-gold-50"
                >
                  .slave
                </a>
              ) : (
                <span
                  title="取込元の車両情報が無いため .slave 化できません（手動登録の純正など）"
                  className="cursor-not-allowed rounded border border-line px-2.5 py-1 text-xs font-semibold text-ink-soft opacity-40"
                >
                  .slave
                </span>
              ))}
            <button
              type="button"
              disabled={busy}
              onClick={() => inputRef.current?.click()}
              className="rounded border border-line px-2.5 py-1 text-xs font-semibold text-ink-soft hover:bg-surface-2 disabled:opacity-50"
            >
              差し替え
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                if (window.confirm(`「${v.label}」を削除します。よろしいですか？（後で復元できます）`))
                  onDelete(v.id);
              }}
              className="rounded border border-red-200 px-2.5 py-1 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
            >
              削除
            </button>
          </div>
          <input
            ref={inputRef}
            type="file"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onReplace(v.id, f);
              e.target.value = "";
            }}
          />
        </div>
      </td>
    </tr>
  );
}
