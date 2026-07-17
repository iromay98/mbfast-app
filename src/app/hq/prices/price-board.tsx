"use client";

import { useState } from "react";
import { Card } from "@/components/ui";
import type { BrandRow, VehicleRow } from "@/lib/prices/types";
import { PriceGrid } from "./price-grid";
import { BrandSettings } from "./brand-settings";

// ブランドタブ + 選択中ブランドの編集グリッド
export function PriceBoard({ data }: { data: { brand: BrandRow; vehicles: VehicleRow[] }[] }) {
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

      <BrandSettings brand={current.brand} />

      <Card className="p-2">
        <PriceGrid key={current.brand.id} brand={current.brand} vehicles={current.vehicles} />
      </Card>
    </div>
  );
}
