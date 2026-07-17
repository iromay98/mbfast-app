"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
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

// 価格をExcel的に編集する表。列はブランド定義（columns）に従って動的に描画する。
export function PriceGrid({ brand, vehicles }: { brand: BrandRow; vehicles: VehicleRow[] }) {
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

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-xs">
          <thead className="bg-surface-2 text-left text-[11px] text-ink-soft">
            <tr>
              <th className="px-1.5 py-1.5 font-semibold">シリーズ</th>
              {brand.columns.map((c) => (
                <th
                  key={c.key}
                  className={`whitespace-nowrap px-1.5 py-1.5 font-semibold ${
                    c.emphasis === "primary" ? "text-gold-700" : ""
                  }`}
                >
                  {c.label}
                </th>
              ))}
              <th className="px-1.5 py-1.5 font-semibold">備考★</th>
              <th className="px-1.5 py-1.5 font-semibold">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {shown.map((v) => (
              <Row
                key={v.id}
                v={v}
                brand={brand}
                pending={pending}
                onRun={run}
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
}: {
  v: VehicleRow;
  brand: BrandRow;
  pending: boolean;
  onRun: (fn: () => Promise<{ ok?: true; error?: string }>) => void;
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
            <Cell value={v.engine} onSave={(val) => onRun(() => updateVehicleCell(v.id, { field: "engine", value: val }))} w="w-28" />
            <Cell
              value={v.engineFamily ?? ""}
              onSave={(val) => onRun(() => updateVehicleCell(v.id, { field: "engineFamily", value: val }))}
              w="w-16"
              placeholder="バッジ"
              mono
            />
          </div>
        );
      case "stockOutput":
        return <Cell value={v.stockOutput ?? ""} onSave={(val) => onRun(() => updateVehicleCell(v.id, { field: "stockOutput", value: val }))} w="w-28" />;
      case "stage1Gain":
        return <Cell value={v.stage1Gain ?? ""} onSave={(val) => onRun(() => updateVehicleCell(v.id, { field: "stage1Gain", value: val }))} w="w-28" />;
      case "labor":
        return <Cell value={v.labor ?? ""} onSave={(val) => onRun(() => updateVehicleCell(v.id, { field: "labor", value: val }))} w="w-24" />;
      case "shops":
        return <Cell value={v.shops ?? ""} onSave={(val) => onRun(() => updateVehicleCell(v.id, { field: "shops", value: val }))} w="w-28" />;
      case "ecuType":
        return <Cell value={v.ecuType ?? ""} onSave={(val) => onRun(() => updateVehicleCell(v.id, { field: "ecuType", value: val }))} w="w-28" mono />;
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
            />
          );
        }
        return <span className="text-ink-soft">—</span>;
    }
  };

  return (
    <tr className="hover:bg-surface-2">
      <td className="px-1.5 py-1">
        <Cell value={v.seriesGroup} onSave={(val) => onRun(() => updateVehicleCell(v.id, { field: "seriesGroup", value: val }))} w="w-24" />
      </td>
      {brand.columns.map((c) => (
        <td key={c.key} className="px-1.5 py-1">
          {cellFor(c)}
        </td>
      ))}
      <td className="px-1.5 py-1">
        <Cell
          value={v.notes ?? ""}
          onSave={(val) => onRun(() => updateVehicleCell(v.id, { field: "notes", value: val }))}
          w="w-28"
          placeholder="（★注記）"
        />
      </td>
      <td className="whitespace-nowrap px-1.5 py-1">
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
}: {
  value: string;
  onSave: (v: string) => void;
  w?: string;
  mono?: boolean;
  bold?: boolean;
  placeholder?: string;
  hint?: boolean; // 主要価格列を強調
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
