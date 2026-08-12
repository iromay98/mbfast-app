"use client";

import { useState } from "react";
import { Card } from "@/components/ui";
import type { BrandRow, VehicleRow } from "@/lib/prices/types";
import type { VpageInfo } from "./vpage-cells";
import type { OptionDef } from "@/lib/vehicle-pages/options";
import { OptionMaster, type OptionRow } from "./option-master";
import { PriceGrid } from "./price-grid";
import { BrandSettings } from "./brand-settings";
import { PublishPanel } from "./publish-panel";

// ブランドタブ + 選択中ブランドの編集グリッド
export function PriceBoard({ data, optionDefs, optionRows }: { data: { brand: BrandRow; vehicles: (VehicleRow & { vpage: VpageInfo })[] }[]; optionDefs: OptionDef[]; optionRows: OptionRow[] }) {
  const [active, setActive] = useState(data[0]?.brand.id ?? "");
  const current = data.find((d) => d.brand.id === active) ?? data[0];
  if (!current) return null;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {data.map(({ brand }) => {
          const on = brand.id === current.brand.id;
          return (
            <button
              key={brand.id}
              type="button"
              onClick={() => setActive(brand.id)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold ${
                on ? "bg-gold-500 text-white" : "border border-line bg-surface text-ink-soft hover:bg-surface-2"
              }`}
            >
              {brand.displayName}
              <span className={`ml-1.5 text-[10px] ${on ? "text-white/80" : "text-ink-soft"}`}>
                {brand.vehicleCount}
              </span>
            </button>
          );
        })}
      </div>

      {/* key: ブランドを切り替えたら入力欄を作り直す（前のブランドの文章が残って誤上書きするのを防ぐ） */}
      <BrandSettings key={`bs-${current.brand.id}`} brand={current.brand} />

      <OptionMaster options={optionRows} priceColumns={current.brand.columns.filter((c) => c.type === "price").map((c) => ({ key: c.key, label: c.label.replace(/\s*\(.*?\)\s*$/, "") }))} />

      <PublishPanel key={`pub-${current.brand.id}`} brand={current.brand} />

      <Card className="p-2">
        <PriceGrid key={current.brand.id} brand={current.brand} vehicles={current.vehicles} optionDefs={optionDefs} />
      </Card>
    </div>
  );
}
