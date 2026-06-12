import Link from "next/link";
import type { ReactNode } from "react";

export function StatCard({
  label,
  value,
  unit,
  href,
  accent = false,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  href?: string;
  accent?: boolean;
}) {
  const inner = (
    <div
      className={`rounded-xl border p-4 transition ${
        accent
          ? "border-gold-200 bg-gold-50"
          : "border-line bg-surface hover:bg-surface-2"
      }`}
    >
      <div className="text-xs font-medium text-ink-soft">{label}</div>
      <div className="mt-1 flex items-baseline gap-1">
        <span className="text-2xl font-bold text-ink">{value}</span>
        {unit && <span className="text-sm text-ink-soft">{unit}</span>}
      </div>
    </div>
  );
  return href ? <Link href={href}>{inner}</Link> : inner;
}
