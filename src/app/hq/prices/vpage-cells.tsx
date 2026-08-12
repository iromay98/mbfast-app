"use client";

// 価格グリッド（/hq/prices）に埋め込む「ページ」列のセル群。
// 行が無い車両でも操作した瞬間に保留行が自動作成される（actions側で ensure）。
//
// オプションは**全メーカーで全項目を選べる**（2026-08 変更）。以前はバブリング・TCU・
// リミッター解除を価格セルからの自動判定に任せて列を出しておらず、その価格列を持たない
// メーカーでは選ぶ手段が無かった。未設定の項目は公開ページに出ない（設定したものだけ出る）。

import type { OptionDef } from "@/lib/vehicle-pages/options";
import { setVpageOptionByVehicle, setVpageStatusByVehicle } from "@/lib/actions/vehicle-pages";

/** グリッドに出すオプション列（全項目）。価格列の有無でメーカーごとに絞らない */
export function manualOptionDefs(defs: OptionDef[]): OptionDef[] {
  return defs;
}

/** グリッド行に渡すページ情報（無ければ null＝未作成） */
export type VpageInfo = { status: string; options: Record<string, boolean> } | null;

const STATUS_STYLE: Record<string, string> = {
  hold: "text-ink-soft",
  draft: "text-amber-700 font-semibold",
  publish: "text-emerald-700 font-semibold",
};

export function VpageStatusCell({
  vehicleId,
  vpage,
  pending,
  onRun,
}: {
  vehicleId: string;
  vpage: VpageInfo;
  pending: boolean;
  onRun: (fn: () => Promise<{ ok?: true; error?: string }>) => void;
}) {
  const status = vpage?.status ?? "hold";
  return (
    <select
      value={status}
      disabled={pending}
      onChange={(e) => onRun(() => setVpageStatusByVehicle(vehicleId, e.target.value))}
      className={`rounded border border-line bg-surface px-1 py-0.5 text-[11px] ${STATUS_STYLE[status] ?? ""}`}
    >
      <option value="hold">保留</option>
      <option value="draft">下書</option>
      <option value="publish">公開</option>
    </select>
  );
}

export function VpageOptionCell({
  vehicleId,
  optionKey,
  vpage,
  pending,
  onRun,
}: {
  vehicleId: string;
  optionKey: string;
  vpage: VpageInfo;
  pending: boolean;
  onRun: (fn: () => Promise<{ ok?: true; error?: string }>) => void;
}) {
  const val = vpage?.options[optionKey];
  const label = val === true ? "〇" : val === false ? "—" : "・";
  const tone = val === true ? "text-gold-700 font-bold" : val === false ? "text-ink-soft" : "text-ink-soft/40";
  return (
    <button
      type="button"
      disabled={pending}
      title="タップで 未設定 → 〇 → — → 未設定（未設定はページに表示されない）"
      onClick={() => {
        const next = val === undefined ? true : val === true ? false : null;
        onRun(() => setVpageOptionByVehicle(vehicleId, optionKey, next));
      }}
      className={`w-full px-1 py-0.5 text-center text-[12px] ${tone}`}
    >
      {label}
    </button>
  );
}
