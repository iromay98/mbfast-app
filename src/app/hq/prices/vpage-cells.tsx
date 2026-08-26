"use client";

// 価格グリッド（/hq/prices）に埋め込む「ページ」列のセル群。
// 高頻度操作なので**楽観的更新**: タップで即座に見た目を変え、保存は裏で走らせる。
// 失敗したときだけ元に戻してエラーを出す（router.refresh は呼ばない＝表全体の再取得をしない）。

import { useState } from "react";
import type { OptionDef } from "@/lib/vehicle-pages/options";
import { setVehiclePageGroup, setVpageOptionByVehicle, setVpageStatusByVehicle } from "@/lib/actions/vehicle-pages";

/** 価格セルから自動判定されるものはグリッドに手動列を出さない（価格列が調整場所） */
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

export function VpageStatusCell({ vehicleId, vpage }: { vehicleId: string; vpage: VpageInfo }) {
  const [status, setStatus] = useState(vpage?.status ?? "hold");
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [warn, setWarn] = useState<string | null>(null);

  // 下書き/公開に変えたら、その場でWPにも反映される（別画面での操作は不要）
  const change = async (next: string) => {
    const prev = status;
    setStatus(next); // 楽観的に反映
    setSaving(true);
    setFailed(false);
    setWarn(null);
    const r = await setVpageStatusByVehicle(vehicleId, next);
    setSaving(false);
    if (r.error) {
      setStatus(prev);
      setFailed(true);
      return;
    }
    if (r.syncWarning) setWarn(r.syncWarning);
  };

  const title = failed ? "保存に失敗しました" : warn ? `WP反映の警告: ${warn}` : saving ? "WPへ反映中…" : "下書き/公開にすると、その場でWPに反映されます";

  return (
    <span className="inline-flex items-center gap-1">
      <select
        value={status}
        onChange={(e) => void change(e.target.value)}
        title={title}
        className={`rounded border bg-surface px-1 py-0.5 text-[11px] ${failed ? "border-red-500" : warn ? "border-amber-500" : "border-line"} ${saving ? "opacity-60" : ""} ${STATUS_STYLE[status] ?? ""}`}
      >
        <option value="hold">保留</option>
        <option value="draft">下書</option>
        <option value="publish">公開</option>
      </select>
      {saving && <span className="text-[10px] text-ink-soft">反映中</span>}
      {!saving && warn && <span className="text-[10px] text-amber-600">!</span>}
    </span>
  );
}

export function VpageOptionCell({
  vehicleId,
  optionKey,
  vpage,
}: {
  vehicleId: string;
  optionKey: string;
  vpage: VpageInfo;
}) {
  const [val, setVal] = useState<boolean | undefined>(vpage?.options[optionKey]);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  const cycle = async () => {
    const prev = val;
    const next = val === undefined ? true : val === true ? false : undefined;
    setVal(next); // 楽観的に反映
    setSaving(true);
    setFailed(false);
    const r = await setVpageOptionByVehicle(vehicleId, optionKey, next === undefined ? null : next);
    setSaving(false);
    if (r.error) {
      setVal(prev);
      setFailed(true);
    }
  };

  const label = val === true ? "〇" : val === false ? "—" : "・";
  const tone = val === true ? "text-gold-700 font-bold" : val === false ? "text-ink-soft" : "text-ink-soft/40";

  return (
    <button
      type="button"
      onClick={() => void cycle()}
      title={failed ? "保存に失敗しました" : "タップで 未設定 → 〇 → — → 未設定（未設定はページに表示されない）"}
      className={`w-full px-1 py-0.5 text-center text-[12px] ${tone} ${saving ? "opacity-50" : ""} ${failed ? "bg-red-100" : ""}`}
    >
      {label}
    </button>
  );
}


/** グレード統合グループの入力セル。同じ値を入れた行が1ページ(タブ切替)に統合される */
export function VpageGroupCell({ vehicleId, group }: { vehicleId: string; group: string | null }) {
  const [v, setV] = useState(group ?? "");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-1">
      <input
        value={v}
        placeholder="（統合キー）"
        disabled={saving}
        onChange={(e) => setV(e.target.value)}
        onBlur={async () => {
          if ((group ?? "") === v.trim()) return;
          setSaving(true);
          const r = await setVehiclePageGroup(vehicleId, v);
          setMsg(r.error ?? (r.members && r.members > 1 ? `${r.members}行を統合` : null));
          setSaving(false);
          setTimeout(() => setMsg(null), 4000);
        }}
        className="w-24 rounded border border-transparent px-1 py-0.5 font-mono text-[11px] hover:border-line focus:border-gold-500 focus:outline-none"
      />
      {msg && <span className="text-[10px] text-ink-soft">{msg}</span>}
    </span>
  );
}
