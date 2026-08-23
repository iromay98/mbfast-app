"use client";

// 価格表をExcel/Airtableのように扱うための操作層。
//
//  - セルをクリックで選択、Shift+クリックで矩形選択
//  - Ctrl/⌘+C で選択範囲をTSVでコピー（Excelにそのまま貼れる）
//  - 選択範囲の右下の■をつまんで下へドラッグすると、その値を流し込む（フィルハンドル）
//
// セルは常時入力可能な <input> のままにして、選択状態はDOMのclassで表現する。
// 190行×十数列を毎回React再描画すると重いので、範囲のハイライトは直接classを付け外しする。

export type CellRef = { row: number; col: number };

export type GridUpdate = { vehicleId: string; field?: string; priceKey?: string; value: string };

const SEL_CLASS = "ring-1 ring-gold-500 bg-gold-500/5";

function inputsIn(container: HTMLElement): HTMLInputElement[] {
  return Array.from(container.querySelectorAll<HTMLInputElement>("input[data-cell-row][data-cell-col]"));
}

export function findInput(container: HTMLElement, row: number, col: string): HTMLInputElement | null {
  return container.querySelector<HTMLInputElement>(`input[data-cell-row="${row}"][data-cell-col="${col}"]`);
}

/** 選択範囲のハイライトを塗り直す */
export function paintSelection(
  container: HTMLElement,
  cellOrder: string[],
  anchor: CellRef | null,
  focus: CellRef | null,
): void {
  for (const el of inputsIn(container)) {
    for (const c of SEL_CLASS.split(" ")) el.classList.remove(c);
  }
  if (!anchor || !focus) return;
  const r1 = Math.min(anchor.row, focus.row);
  const r2 = Math.max(anchor.row, focus.row);
  const c1 = Math.min(anchor.col, focus.col);
  const c2 = Math.max(anchor.col, focus.col);
  for (let r = r1; r <= r2; r++) {
    for (let c = c1; c <= c2; c++) {
      const el = findInput(container, r, cellOrder[c]);
      if (!el) continue;
      for (const cls of SEL_CLASS.split(" ")) el.classList.add(cls);
    }
  }
}

/** 選択範囲をTSVにする（Excelへの貼り付け用） */
export function selectionToTsv(
  container: HTMLElement,
  cellOrder: string[],
  anchor: CellRef,
  focus: CellRef,
): string {
  const r1 = Math.min(anchor.row, focus.row);
  const r2 = Math.max(anchor.row, focus.row);
  const c1 = Math.min(anchor.col, focus.col);
  const c2 = Math.max(anchor.col, focus.col);
  const lines: string[] = [];
  for (let r = r1; r <= r2; r++) {
    const cols: string[] = [];
    for (let c = c1; c <= c2; c++) {
      cols.push(findInput(container, r, cellOrder[c])?.value ?? "");
    }
    lines.push(cols.join("\t"));
  }
  return lines.join("\n");
}

/** カーソル位置(clientX/Y)がどのセルかを返す */
export function cellAtPoint(x: number, y: number, cellOrder: string[]): CellRef | null {
  const el = document.elementFromPoint(x, y) as HTMLElement | null;
  const input = el?.closest?.("input[data-cell-row][data-cell-col]") as HTMLInputElement | null;
  const host = input ?? (el?.querySelector?.("input[data-cell-row]") as HTMLInputElement | null);
  if (!host) return null;
  const row = Number(host.getAttribute("data-cell-row"));
  const col = cellOrder.indexOf(host.getAttribute("data-cell-col") ?? "");
  if (!Number.isFinite(row) || col < 0) return null;
  return { row, col };
}

/**
 * フィルハンドルで下方向へ流し込む内容を組み立てる。
 * 選択範囲の値を、対象行まで繰り返しコピーする（Excelと同じ挙動）。
 */
export function buildFillUpdates(args: {
  container: HTMLElement;
  cellOrder: string[];
  anchor: CellRef;
  focus: CellRef;
  toRow: number;
  vehicleIdAt: (row: number) => string | null;
}): GridUpdate[] {
  const { container, cellOrder, anchor, focus, toRow, vehicleIdAt } = args;
  const r1 = Math.min(anchor.row, focus.row);
  const r2 = Math.max(anchor.row, focus.row);
  const c1 = Math.min(anchor.col, focus.col);
  const c2 = Math.max(anchor.col, focus.col);
  if (toRow <= r2) return [];

  const source: string[][] = [];
  for (let r = r1; r <= r2; r++) {
    const cols: string[] = [];
    for (let c = c1; c <= c2; c++) cols.push(findInput(container, r, cellOrder[c])?.value ?? "");
    source.push(cols);
  }

  const updates: GridUpdate[] = [];
  const height = source.length;
  for (let r = r2 + 1; r <= toRow; r++) {
    const vehicleId = vehicleIdAt(r);
    if (!vehicleId) continue;
    const src = source[(r - r1) % height];
    src.forEach((value, i) => {
      const colKey = cellOrder[c1 + i];
      if (!colKey) return;
      updates.push(
        colKey.startsWith("price:")
          ? { vehicleId, priceKey: colKey.slice(6), value }
          : { vehicleId, field: colKey, value },
      );
    });
  }
  return updates;
}
