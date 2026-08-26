"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  bulkUpdateCells,
  addVehicle,
  deleteVehicle,
  duplicateVehicle,
  moveVehicle,
  updateVehicleCell,
} from "@/lib/actions/prices";
import {
  REMOTE_TOOLS,
  type BrandRow,
  type ColumnDefinition,
  type RemoteFlags,
  type VehicleRow,
} from "@/lib/prices/types";
import { manualOptionDefs, VpageGroupCell, VpageOptionCell, VpageStatusCell, type VpageInfo } from "./vpage-cells";
import type { OptionDef } from "@/lib/vehicle-pages/options";
import {
  buildFillUpdates,
  cellAtPoint,
  findInput,
  paintSelection,
  selectionToTsv,
  type CellRef,
} from "./grid-selection";

type GridVehicle = VehicleRow & { vpage: VpageInfo };

// 価格をExcel的に編集する表。列はブランド定義（columns）に従って動的に描画する。
export function PriceGrid({ brand, vehicles, optionDefs }: { brand: BrandRow; vehicles: GridVehicle[]; optionDefs: OptionDef[] }) {
  const manualOpts = manualOptionDefs(optionDefs);
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [series, setSeries] = useState<string>("all");

  const run = (fn: () => Promise<{ ok?: true; error?: string }>) =>
    start(async () => {
      const r = await fn();
      setMsg(r?.error ?? null);
      router.refresh();
    });

  const shown = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return vehicles.filter((v) => {
      if (series !== "all" && v.seriesGroup !== series) return false;
      if (!kw) return true;
      return [v.carName, v.grade, v.engine, v.engineFamily, v.ecuType]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(kw));
    });
  }, [vehicles, q, series]);

  // ── Excel的なコピー＆貼り付け ──
  // セルにカーソルを置いて Ctrl/Cmd+V: そのセルを左上として右・下方向へ流し込む
  // Ctrl/Cmd+D: そのセルの値を、下の行の同じ列へコピー（フィルダウン）
  const gridRef = useRef<HTMLDivElement>(null);

  const cellOrder = useMemo(() => {
    const keys: string[] = ["carName", "grade", "seriesGroup"];
    for (const c of brand.columns) {
      if (c.key === "car" || c.key === "grade" || c.key === "maker" || c.key === "remote") continue;
      if (c.type === "price") keys.push(`price:${c.key}`);
      else if (["engine", "stockOutput", "stage1Gain", "labor", "shops", "ecuType"].includes(c.key)) keys.push(c.key);
    }
    keys.push("notes");
    return keys;
  }, [brand.columns]);

  // 選択範囲（Excel的な矩形選択）。DOM操作で描画するのでstateにしない
  const anchorRef = useRef<CellRef | null>(null);
  const focusRef = useRef<CellRef | null>(null);
  const [handlePos, setHandlePos] = useState<{ top: number; left: number } | null>(null);

  // 選択の変化を画面に反映し、フィルハンドルの位置を更新する
  const refreshSelection = () => {
    const el = gridRef.current;
    if (!el) return;
    paintSelection(el, cellOrder, anchorRef.current, focusRef.current);
    const a = anchorRef.current;
    const f = focusRef.current;
    if (!a || !f) {
      setHandlePos(null);
      return;
    }
    const lastRow = Math.max(a.row, f.row);
    const lastCol = Math.max(a.col, f.col);
    const cell = findInput(el, lastRow, cellOrder[lastCol]);
    if (!cell) {
      setHandlePos(null);
      return;
    }
    const box = cell.getBoundingClientRect();
    const host = el.getBoundingClientRect();
    setHandlePos({ top: box.bottom - host.top + el.scrollTop - 4, left: box.right - host.left + el.scrollLeft - 4 });
  };

  useEffect(() => {
    const el = gridRef.current;
    if (!el) return;

    const cellTarget = (colKey: string, value: string, vehicleId: string) =>
      colKey.startsWith("price:")
        ? { vehicleId, priceKey: colKey.slice(6), value }
        : { vehicleId, field: colKey, value };

    const applyBulk = (
      updates: { vehicleId: string; field?: string; priceKey?: string; value: string }[],
      label: string,
    ) => {
      if (updates.length === 0) return;
      if (!window.confirm(`${label}（${updates.length}セル）を実行します。よろしいですか？`)) return;
      start(async () => {
        const r = await bulkUpdateCells(updates);
        setMsg(r.error ?? `${r.updated ?? 0} 行を更新しました`);
        router.refresh();
      });
    };

    const onPaste = (e: ClipboardEvent) => {
      const active = document.activeElement as HTMLElement | null;
      const rowAttr = active?.getAttribute?.("data-cell-row");
      const colAttr = active?.getAttribute?.("data-cell-col");
      if (!rowAttr || !colAttr) return;
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (!text.includes("\t") && !text.includes("\n")) return; // 単一セルは通常の貼り付け
      e.preventDefault();
      const startRow = Number(rowAttr);
      const startCol = cellOrder.indexOf(colAttr);
      if (startCol < 0) return;
      const matrix = text
        .replace(/\r/g, "")
        .replace(/\n+$/, "")
        .split("\n")
        .map((line) => line.split("\t"));
      const updates: { vehicleId: string; field?: string; priceKey?: string; value: string }[] = [];
      matrix.forEach((cols, dy) => {
        const target = shown[startRow + dy];
        if (!target) return;
        cols.forEach((val, dx) => {
          const colKey = cellOrder[startCol + dx];
          if (!colKey) return;
          updates.push(cellTarget(colKey, val, target.id));
        });
      });
      applyBulk(updates, "Excelから貼り付け");
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== "d") return;
      const active = document.activeElement as HTMLInputElement | null;
      const rowAttr = active?.getAttribute?.("data-cell-row");
      const colAttr = active?.getAttribute?.("data-cell-col");
      if (!rowAttr || !colAttr) return;
      e.preventDefault();
      const startRow = Number(rowAttr);
      const value = active?.value ?? "";
      const updates = shown.slice(startRow + 1).map((t) => cellTarget(colAttr, value, t.id));
      applyBulk(updates, `下の行へコピー（${value || "空"}）`);
    };

    // クリック/フォーカスで選択、Shift+クリックで矩形選択
    const onFocusIn = (e: FocusEvent) => {
      const t = e.target as HTMLElement | null;
      const rowAttr = t?.getAttribute?.("data-cell-row");
      const colAttr = t?.getAttribute?.("data-cell-col");
      if (!rowAttr || !colAttr) return;
      const ref = { row: Number(rowAttr), col: cellOrder.indexOf(colAttr) };
      if (ref.col < 0) return;
      anchorRef.current = ref;
      focusRef.current = ref;
      refreshSelection();
    };

    const onMouseDown = (e: MouseEvent) => {
      if (!e.shiftKey || !anchorRef.current) return;
      const ref = cellAtPoint(e.clientX, e.clientY, cellOrder);
      if (!ref) return;
      e.preventDefault(); // 範囲選択を優先（文字選択にしない）
      focusRef.current = ref;
      refreshSelection();
    };

    const onCopy = (e: ClipboardEvent) => {
      const a = anchorRef.current;
      const f = focusRef.current;
      if (!a || !f) return;
      if (a.row === f.row && a.col === f.col) return; // 単一セルは通常のコピー
      e.preventDefault();
      e.clipboardData?.setData("text/plain", selectionToTsv(el, cellOrder, a, f));
      setMsg("選択範囲をコピーしました（Excelに貼り付けできます）");
    };

    el.addEventListener("focusin", onFocusIn);
    el.addEventListener("mousedown", onMouseDown);
    el.addEventListener("copy", onCopy as EventListener);
    el.addEventListener("paste", onPaste as EventListener);
    el.addEventListener("keydown", onKeyDown);
    return () => {
      el.removeEventListener("focusin", onFocusIn);
      el.removeEventListener("mousedown", onMouseDown);
      el.removeEventListener("copy", onCopy as EventListener);
      el.removeEventListener("paste", onPaste as EventListener);
      el.removeEventListener("keydown", onKeyDown);
    };
  }, [cellOrder, shown, router]);

  return (
    <div className="space-y-2">
      {/* 検索・フィルタ・追加 */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="🔍 車種・グレード・エンジン・ECUで検索"
          className="min-w-[14rem] flex-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm"
        />
        <select
          value={series}
          onChange={(e) => setSeries(e.target.value)}
          className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm"
        >
          <option value="all">全シリーズ</option>
          {brand.seriesGroups.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <span className="text-xs text-ink-soft">
          {shown.length} / {vehicles.length} 件
        <span className="ml-2 hidden text-[10px] text-ink-soft sm:inline">
          Shift+クリックで範囲選択 ／ Ctrl/⌘+C でコピー ／ Ctrl/⌘+V でExcelから貼り付け ／ 右下の■を下へドラッグで流し込み ／ Ctrl/⌘+D で下へコピー
        </span>
        </span>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => addVehicle(brand.id))}
          className="ml-auto rounded-lg bg-gold-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          ＋ 行を追加
        </button>
      </div>
      {pending && <p className="text-xs text-ink-soft">保存中…</p>}
      {msg && <p className="text-xs text-red-600">{msg}</p>}

      {/* 縦横スクロール。ヘッダー行は上に、車両列は左に固定する（行を見失わないため） */}
      <div ref={gridRef} className="relative max-h-[70vh] overflow-auto rounded-lg border border-line">
        {handlePos && (
          <div
            title="つまんで下へドラッグすると、この値を流し込みます"
            onPointerDown={(e) => {
              e.preventDefault();
              const el = gridRef.current;
              const a = anchorRef.current;
              const f = focusRef.current;
              if (!el || !a || !f) return;
              const startBottom = Math.max(a.row, f.row);
              let toRow = startBottom;

              const move = (ev: PointerEvent) => {
                const ref = cellAtPoint(ev.clientX, ev.clientY, cellOrder);
                if (ref && ref.row > startBottom) {
                  toRow = ref.row;
                  paintSelection(el, cellOrder, a, { row: toRow, col: Math.max(a.col, f.col) });
                }
              };
              const up = () => {
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", up);
                if (toRow <= startBottom) {
                  refreshSelection();
                  return;
                }
                const updates = buildFillUpdates({
                  container: el,
                  cellOrder,
                  anchor: a,
                  focus: f,
                  toRow,
                  vehicleIdAt: (r) => shown[r]?.id ?? null,
                });
                if (updates.length === 0) {
                  refreshSelection();
                  return;
                }
                if (!window.confirm(`下へ流し込み（${updates.length}セル）を実行します。よろしいですか？`)) {
                  refreshSelection();
                  return;
                }
                start(async () => {
                  const r = await bulkUpdateCells(updates);
                  setMsg(r.error ?? `${r.updated ?? 0} 行を更新しました`);
                  router.refresh();
                });
              };
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", up);
            }}
            style={{ top: handlePos.top, left: handlePos.left }}
            className="absolute z-20 h-2.5 w-2.5 cursor-crosshair rounded-[2px] border border-white bg-gold-500 shadow"
          />
        )}
        <table className="w-full border-separate border-spacing-0 text-xs">
          <thead className="sticky top-0 z-30 bg-surface-2 text-left text-[11px] text-ink-soft">
            <tr>
              <th className="sticky left-0 top-0 z-40 border-b border-r border-line bg-surface-2 px-1.5 py-1.5 font-semibold">
                車両
              </th>
              <th className="border-b border-line px-1.5 py-1.5 font-semibold">シリーズ</th>
              {brand.columns.filter((c) => c.key !== "car" && c.key !== "grade").map((c) => (
                <th
                  key={c.key}
                  className={`whitespace-nowrap px-1.5 py-1.5 font-semibold ${
                    c.emphasis === "primary" ? "text-gold-700" : ""
                  }`}
                >
                  {c.label}
                </th>
              ))}
              <th className="border-b border-line px-1.5 py-1.5 font-semibold">備考★</th>
              <th className="border-b border-l border-line px-1.5 py-1.5 font-semibold" title="車両ページの公開状態">頁</th>
              <th className="border-b border-line px-1.5 py-1.5 font-semibold" title="同じキーを入れた行が1つの車両ページ(グレードタブ切替)に統合されます。先頭行が代表">統合</th>
              {manualOpts.map((o) => (
                <th key={o.key} className="border-b border-line px-1 py-1.5 text-center font-semibold" title={o.jp}>
                  {o.short ?? o.jp}
                </th>
              ))}
              <th className="border-b border-line px-1.5 py-1.5 font-semibold">操作</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((v, i) => (
              <Row
                key={v.id}
                v={v}
                brand={brand}
                pending={pending}
                onRun={run}
                manualOpts={manualOpts}
                rowIndex={i}
              />
            ))}
          </tbody>
        </table>
      </div>
      {shown.length === 0 && (
        <p className="py-6 text-center text-xs text-ink-soft">該当する行がありません。</p>
      )}
    </div>
  );
}

function Row({
  v,
  brand,
  pending,
  onRun,
  manualOpts,
  rowIndex,
}: {
  v: GridVehicle;
  brand: BrandRow;
  pending: boolean;
  onRun: (fn: () => Promise<{ ok?: true; error?: string }>) => void;
  manualOpts: OptionDef[];
  rowIndex: number;
}) {
  // 列キー → その行の値を取り出す
  const cellFor = (c: ColumnDefinition) => {
    switch (c.key) {
      case "car":
        return (
          <Cell value={v.carName} onSave={(val) => onRun(() => updateVehicleCell(v.id, { field: "carName", value: val }))} w="w-36" bold />
        );
      case "grade":
        return <Cell value={v.grade ?? ""} onSave={(val) => onRun(() => updateVehicleCell(v.id, { field: "grade", value: val }))} w="w-24" />;
      case "engine":
        return (
          <div className="flex items-center gap-1">
            <Cell value={v.engine} onSave={(val) => onRun(() => updateVehicleCell(v.id, { field: "engine", value: val }))} w="w-28" cellRow={rowIndex} cellCol="engine" />
            <Cell
              value={v.engineFamily ?? ""}
              onSave={(val) => onRun(() => updateVehicleCell(v.id, { field: "engineFamily", value: val }))}
              w="w-16"
              placeholder="バッジ"
              mono
            />
          </div>
        );
      case "maker":
        // メーカー列（「その他」ブランドのみ）。値=シリーズ名。編集は先頭のシリーズ列で行う
        return <span className="px-1 text-xs text-ink-soft">{v.seriesGroup}</span>;
      case "stockOutput":
        return <Cell value={v.stockOutput ?? ""} onSave={(val) => onRun(() => updateVehicleCell(v.id, { field: "stockOutput", value: val }))} w="w-28" cellRow={rowIndex} cellCol="stockOutput" />;
      case "stage1Gain":
        return <Cell value={v.stage1Gain ?? ""} onSave={(val) => onRun(() => updateVehicleCell(v.id, { field: "stage1Gain", value: val }))} w="w-28" cellRow={rowIndex} cellCol="stage1Gain" />;
      case "labor":
        return <Cell value={v.labor ?? ""} onSave={(val) => onRun(() => updateVehicleCell(v.id, { field: "labor", value: val }))} w="w-24" cellRow={rowIndex} cellCol="labor" />;
      case "shops":
        return <Cell value={v.shops ?? ""} onSave={(val) => onRun(() => updateVehicleCell(v.id, { field: "shops", value: val }))} w="w-28" cellRow={rowIndex} cellCol="shops" />;
      case "ecuType":
        return <Cell value={v.ecuType ?? ""} onSave={(val) => onRun(() => updateVehicleCell(v.id, { field: "ecuType", value: val }))} w="w-28" mono cellRow={rowIndex} cellCol="ecuType" />;
      case "remote":
        return <RemoteCell v={v} pending={pending} onRun={onRun} />;
      default:
        // 価格列（動的キー）
        if (c.type === "price") {
          return (
            <Cell
              value={v.prices[c.key] ?? ""}
              onSave={(val) => onRun(() => updateVehicleCell(v.id, { priceKey: c.key, priceValue: val }))}
              w="w-24"
              mono
              placeholder="LINE"
              hint={c.emphasis === "primary"}
              cellRow={rowIndex}
              cellCol={`price:${c.key}`}
            />
          );
        }
        return <span className="text-ink-soft">—</span>;
    }
  };

  const hasGrade = brand.columns.some((c) => c.key === "grade");
  return (
    <tr className="group hover:bg-surface-2">
      <td className="sticky left-0 z-10 border-b border-r border-line bg-surface px-1.5 py-1 align-top group-hover:bg-surface-2">
        <div className="space-y-0.5">
          <Cell value={v.carName} onSave={(val) => onRun(() => updateVehicleCell(v.id, { field: "carName", value: val }))} w="w-32" bold cellRow={rowIndex} cellCol="carName" />
          {hasGrade && (
            <Cell value={v.grade ?? ""} onSave={(val) => onRun(() => updateVehicleCell(v.id, { field: "grade", value: val }))} w="w-32" placeholder="（グレード）" cellRow={rowIndex} cellCol="grade" />
          )}
        </div>
      </td>
      <td className="border-b border-line px-1.5 py-1">
        <Cell value={v.seriesGroup} onSave={(val) => onRun(() => updateVehicleCell(v.id, { field: "seriesGroup", value: val }))} w="w-24" cellRow={rowIndex} cellCol="seriesGroup" />
      </td>
      {brand.columns.filter((c) => c.key !== "car" && c.key !== "grade").map((c) => (
        <td key={c.key} className="border-b border-line px-1.5 py-1">
          {cellFor(c)}
        </td>
      ))}
      <td className="border-b border-line px-1.5 py-1">
        <Cell
          value={v.notes ?? ""}
          onSave={(val) => onRun(() => updateVehicleCell(v.id, { field: "notes", value: val }))}
          w="w-28"
          placeholder="（★注記）"
          cellRow={rowIndex}
          cellCol="notes"
        />
      </td>
      <td className="border-b border-l border-line px-1 py-1">
        <VpageStatusCell vehicleId={v.id} vpage={v.vpage} />
      </td>
      <td className="border-b border-line px-1 py-1">
        <VpageGroupCell vehicleId={v.id} group={v.pageGroup ?? null} />
      </td>
      {manualOpts.map((o) => (
        <td key={o.key} className="border-b border-line px-0.5 py-1 text-center">
          <VpageOptionCell vehicleId={v.id} optionKey={o.key} vpage={v.vpage} />
        </td>
      ))}
      <td className="whitespace-nowrap border-b border-line px-1.5 py-1">
        <div className="flex items-center gap-0.5">
          <IconBtn title="上へ" disabled={pending} onClick={() => onRun(() => moveVehicle(v.id, "up"))}>
            ↑
          </IconBtn>
          <IconBtn title="下へ" disabled={pending} onClick={() => onRun(() => moveVehicle(v.id, "down"))}>
            ↓
          </IconBtn>
          <IconBtn title="複製" disabled={pending} onClick={() => onRun(() => duplicateVehicle(v.id))}>
            ⧉
          </IconBtn>
          <button
            type="button"
            disabled={pending}
            title="削除"
            onClick={() => {
              if (window.confirm(`「${v.carName} ${v.grade ?? ""}」を削除します。よろしいですか？`))
                onRun(() => deleteVehicle(v.id));
            }}
            className="rounded border border-red-200 px-1 text-[10px] font-bold text-red-600 hover:bg-red-50 disabled:opacity-50"
          >
            ✕
          </button>
        </div>
      </td>
    </tr>
  );
}

function RemoteCell({
  v,
  pending,
  onRun,
}: {
  v: VehicleRow;
  pending: boolean;
  onRun: (fn: () => Promise<{ ok?: true; error?: string }>) => void;
}) {
  return (
    <div className="flex items-center gap-0.5">
      {REMOTE_TOOLS.map((t) => {
        const on = !!v.remote[t.key];
        return (
          <button
            key={t.key}
            type="button"
            disabled={pending}
            title={t.title}
            onClick={() => {
              const next: RemoteFlags = { ...v.remote, [t.key]: !on };
              onRun(() => updateVehicleCell(v.id, { remote: next }));
            }}
            className={`rounded px-1 py-0.5 text-[9px] font-bold ${
              on ? "bg-green-600 text-white" : "bg-surface-2 text-ink-soft"
            } disabled:opacity-50`}
          >
            {t.badge}
          </button>
        );
      })}
    </div>
  );
}

function IconBtn({
  children,
  title,
  disabled,
  onClick,
}: {
  children: React.ReactNode;
  title: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className="rounded border border-line px-1 text-[10px] text-ink-soft hover:bg-surface disabled:opacity-50"
    >
      {children}
    </button>
  );
}

// blur / Enter で保存するセル
function Cell({
  value,
  onSave,
  w,
  mono,
  bold,
  placeholder,
  hint,
  cellRow,
  cellCol,
}: {
  value: string;
  onSave: (v: string) => void;
  w?: string;
  mono?: boolean;
  bold?: boolean;
  placeholder?: string;
  hint?: boolean; // 主要価格列を強調
  cellRow?: number; // Excel貼り付け用の座標（行番号）
  cellCol?: string; // 同（列キー）
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
      data-cell-row={cellRow}
      data-cell-col={cellCol}
      placeholder={placeholder}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (v !== value) onSave(v.trim());
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") {
          setV(value);
          e.currentTarget.blur();
        }
      }}
      className={`${w ?? "w-24"} min-w-0 rounded border border-transparent bg-transparent px-1 py-0.5 text-xs hover:border-line focus:border-gold-400 focus:bg-surface focus:outline-none ${
        mono ? "font-mono" : ""
      } ${bold ? "font-semibold" : ""} ${hint ? "bg-gold-50/50" : ""}`}
    />
  );
}
