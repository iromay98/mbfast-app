"use client";

import { useMemo, useState } from "react";
import {
  REMOTE_TOOLS,
  type ColumnDefinition,
  type VehicleRow,
} from "@/lib/prices/types";

export type ViewerBrand = {
  id: string;
  displayName: string;
  seriesGroups: string[];
  columns: ColumnDefinition[];
  vehicles: VehicleRow[];
};

// 価格セルの表示（HQは生値編集だが、こちらは公開ページ相当の見せ方に整形）
function priceText(raw: string | undefined, c: ColumnDefinition): string {
  const v = (raw ?? "").trim();
  if (v === "") {
    // 公開ページでは空欄=LINE問合せボタン（dash系設定の列は「—」）
    return c.emptyBehavior === "dash" || c.emptyBehavior === "dash-if-primary-filled"
      ? "—"
      : "要問合せ";
  }
  if (v.toUpperCase() === "ASK") return "要問合せ";
  if (/^\d+$/.test(v)) return `¥${Number(v).toLocaleString("ja-JP")}`;
  return v;
}

// 選択中の1ブランドを表示（検索・シリーズ絞り込みつき・閲覧専用）
export function PriceViewer({ brand }: { brand: ViewerBrand }) {
  const [q, setQ] = useState("");
  const [series, setSeries] = useState("all");

  const shown = useMemo(() => {
    const kw = q.trim().toLowerCase();
    return brand.vehicles.filter((v) => {
      if (series !== "all" && v.seriesGroup !== series) return false;
      if (!kw) return true;
      return [v.carName, v.grade, v.engine, v.engineFamily, v.ecuType, v.seriesGroup]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(kw));
    });
  }, [brand, q, series]);

  const hasNotes = shown.some((v) => v.notes);

  const cellFor = (v: VehicleRow, c: ColumnDefinition) => {
    switch (c.key) {
      case "car":
        return <span className="font-semibold text-ink">{v.carName}</span>;
      case "grade":
        return v.grade || "—";
      case "engine":
        return (
          <span>
            {v.engine || "—"}
            {v.engineFamily && (
              <span className="ml-1 rounded bg-surface-2 px-1 py-0.5 font-mono text-[10px] text-ink-soft">
                {v.engineFamily}
              </span>
            )}
          </span>
        );
      case "stockOutput":
        return v.stockOutput || "—";
      case "stage1Gain":
        return v.stage1Gain || "—";
      case "labor":
        return v.labor ? priceText(v.labor, c) : "—";
      case "shops":
        return v.shops || "—";
      case "ecuType":
        return v.ecuType ? <span className="font-mono">{v.ecuType}</span> : "—";
      case "remote": {
        const on = REMOTE_TOOLS.filter((t) => v.remote[t.key]);
        return on.length === 0 ? (
          "—"
        ) : (
          <span className="flex flex-wrap gap-0.5">
            {on.map((t) => (
              <span
                key={t.key}
                title={t.title}
                className="rounded bg-green-600 px-1 py-0.5 text-[9px] font-bold text-white"
              >
                {t.badge}
              </span>
            ))}
          </span>
        );
      }
      default:
        if (c.type === "price") {
          const txt = priceText(v.prices[c.key], c);
          return (
            <span
              className={`font-mono ${
                c.emphasis === "primary" ? "font-semibold text-gold-700" : ""
              } ${txt === "要問合せ" ? "text-[10px] text-ink-soft" : ""}`}
            >
              {txt}
            </span>
          );
        }
        return "—";
    }
  };

  return (
    <div className="space-y-3">
      {/* 検索・シリーズ絞り込み */}
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="🔍 車種・グレード・エンジンで検索"
          className="min-w-[12rem] flex-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm"
        />
        {brand.seriesGroups.length > 0 && (
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
        )}
        <span className="text-xs text-ink-soft">
          {shown.length} / {brand.vehicles.length} 件
        </span>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-xs">
          <thead className="bg-surface-2 text-left text-[11px] text-ink-soft">
            <tr>
              {brand.columns.map((c) => (
                <th
                  key={c.key}
                  className={`whitespace-nowrap px-2 py-2 font-semibold ${
                    c.emphasis === "primary" ? "text-gold-700" : ""
                  }`}
                >
                  {c.label}
                </th>
              ))}
              {hasNotes && <th className="px-2 py-2 font-semibold">備考</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {shown.map((v) => (
              <tr key={v.id} className="hover:bg-surface-2">
                {brand.columns.map((c) => (
                  <td key={c.key} className="whitespace-nowrap px-2 py-1.5">
                    {cellFor(v, c)}
                  </td>
                ))}
                {hasNotes && (
                  <td className="px-2 py-1.5 text-[10px] text-ink-soft">
                    {/* 表の自動レイアウトで潰れて1文字ずつ縦に折り返さないよう最小幅を確保 */}
                    <div className="min-w-[10rem] max-w-[16rem]">{v.notes ?? ""}</div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
        {shown.length === 0 && (
          <p className="py-6 text-center text-xs text-ink-soft">該当する車種がありません。</p>
        )}
      </div>
      <p className="text-[11px] text-ink-soft">
        ※ 公開ホームページと同じ本店マスタの最新値を表示しています。「要問合せ」の車種は本店までご相談ください。
      </p>
    </div>
  );
}
