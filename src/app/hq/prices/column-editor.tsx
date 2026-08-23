"use client";

// 価格表の列編集。列の追加（ECU/TCU・価格列など）・ラベル変更・並べ替え・削除ができる。
// 表示だけでなく公開HTMLの列構成もこれに従うので、変更後は「WordPressに反映」を忘れずに。

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import type { BrandRow } from "@/lib/prices/types";
import { knownAddableColumns, updateBrandColumns } from "@/lib/actions/prices";

type EditCol = { key: string; label: string; type: string; isNew?: boolean };

export function ColumnEditor({ brand }: { brand: BrandRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [cols, setCols] = useState<EditCol[]>([]);
  const [addable, setAddable] = useState<{ key: string; label: string; type: string }[]>([]);
  const [newPriceKey, setNewPriceKey] = useState("");
  const [newPriceLabel, setNewPriceLabel] = useState("");

  const load = () =>
    start(async () => {
      setCols(brand.columns.map((c) => ({ key: c.key, label: c.label, type: c.type })));
      setAddable(await knownAddableColumns(brand.id));
      setOpen(true);
    });

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= cols.length) return;
    const next = [...cols];
    [next[i], next[j]] = [next[j], next[i]];
    setCols(next);
  };

  const fixed = (c: EditCol) => c.key === "car" || c.key === "grade";

  if (!open) {
    return (
      <button type="button" onClick={load} className="text-xs text-ink-soft underline underline-offset-2 hover:text-ink">
        列を編集（追加・並べ替え・ECU/TCU列など）
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">列の編集 — {brand.displayName}</h3>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-ink-soft hover:underline">
          閉じる
        </button>
      </div>
      <p className="mb-2 text-[11px] text-ink-soft">
        表示とWP公開ページの両方の列構成が変わります。保存後は「WordPressに反映」で公開側も更新してください。
        車種・グレードは土台のため固定です。
      </p>

      <ul className="mb-3 space-y-1">
        {cols.map((c, i) => (
          <li key={c.key} className="flex items-center gap-2 rounded border border-line bg-surface-2 px-2 py-1">
            <span className="w-24 truncate font-mono text-[10px] text-ink-soft">{c.key}</span>
            <input
              value={c.label}
              disabled={pending || fixed(c)}
              onChange={(e) => setCols((prev) => prev.map((x, xi) => (xi === i ? { ...x, label: e.target.value } : x)))}
              className="w-40 rounded border border-transparent px-1 py-0.5 text-xs hover:border-line focus:border-gold-500 focus:outline-none"
            />
            <span className="text-[10px] text-ink-soft">{c.type === "price" ? "価格" : c.type}</span>
            <span className="ml-auto" />
            <button type="button" disabled={pending || i === 0 || fixed(c)} onClick={() => move(i, -1)} className="px-1 disabled:opacity-30">
              ↑
            </button>
            <button type="button" disabled={pending || i === cols.length - 1 || fixed(c)} onClick={() => move(i, 1)} className="px-1 disabled:opacity-30">
              ↓
            </button>
            <button
              type="button"
              disabled={pending || fixed(c)}
              onClick={() => {
                if (c.type === "price" && !c.isNew) {
                  if (!confirm(`価格列「${c.label}」を消すと、この列の金額はページに出なくなります（データは残ります）。よろしいですか？`)) return;
                }
                setCols((prev) => prev.filter((_, xi) => xi !== i));
              }}
              className="text-ink-soft hover:text-red-600 disabled:opacity-30"
            >
              削除
            </button>
          </li>
        ))}
      </ul>

      <div className="mb-3 flex flex-wrap items-end gap-2 rounded border border-line bg-surface-2 p-2">
        <div>
          <p className="mb-1 text-[10px] text-ink-soft">既定の列を追加</p>
          <div className="flex flex-wrap gap-1">
            {addable
              .filter((a) => !cols.some((c) => c.key === a.key))
              .map((a) => (
                <button
                  key={a.key}
                  type="button"
                  disabled={pending}
                  onClick={() => setCols((prev) => [...prev, { key: a.key, label: a.label, type: a.type, isNew: true }])}
                  className="rounded border border-dashed border-line px-2 py-0.5 text-xs hover:bg-surface"
                >
                  ＋ {a.label}
                </button>
              ))}
          </div>
        </div>
        <div className="ml-auto flex items-end gap-1">
          <label className="block">
            <span className="mb-0.5 block text-[10px] text-ink-soft">価格列を追加（キー半角）</span>
            <input value={newPriceKey} onChange={(e) => setNewPriceKey(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} placeholder="stage2" className="w-24 rounded border border-line px-2 py-1 text-xs" />
          </label>
          <label className="block">
            <span className="mb-0.5 block text-[10px] text-ink-soft">ラベル</span>
            <input value={newPriceLabel} onChange={(e) => setNewPriceLabel(e.target.value)} placeholder="Stage2" className="w-28 rounded border border-line px-2 py-1 text-xs" />
          </label>
          <button
            type="button"
            disabled={pending || !newPriceKey.trim() || !newPriceLabel.trim() || cols.some((c) => c.key === newPriceKey.trim())}
            onClick={() => {
              setCols((prev) => [...prev, { key: newPriceKey.trim(), label: newPriceLabel.trim(), type: "price", isNew: true }]);
              setNewPriceKey("");
              setNewPriceLabel("");
            }}
            className="rounded border border-line px-2 py-1 text-xs hover:bg-surface"
          >
            追加
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          disabled={pending}
          onClick={() =>
            start(async () => {
              const r = await updateBrandColumns(
                brand.id,
                cols.map((c, i) => ({ key: c.key, label: c.label, type: c.type, order: i })),
              );
              setMsg(r.error ?? "保存しました（公開側は「WordPressに反映」で更新されます）");
              if (!r.error) router.refresh();
            })
          }
        >
          {pending ? "保存中…" : "保存"}
        </Button>
        {msg && <span className="text-xs text-ink-soft">{msg}</span>}
      </div>
    </div>
  );
}
