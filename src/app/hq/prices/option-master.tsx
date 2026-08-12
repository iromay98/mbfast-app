"use client";

// 車両ページ「対応オプション」の語彙マスタ編集。価格表画面から開く（列の追加と同じ感覚）。
// ここで追加した項目が、価格表グリッドの○×列・車両ページ本文・車両ページ画面に反映される。

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { OptionDef } from "@/lib/vehicle-pages/options";
import { suggestOptionKey } from "@/lib/vehicle-pages/options";
import {
  createOptionDef,
  deleteOptionDef,
  moveOptionDef,
  updateOptionDef,
} from "@/lib/actions/vehicle-pages";

export type OptionRow = OptionDef & { id: string; enabled: boolean };

export function OptionMaster({ options, priceColumns }: { options: OptionRow[]; priceColumns: { key: string; label: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [ja, setJa] = useState("");
  const [en, setEn] = useState("");
  const [short, setShort] = useState("");
  const [key, setKey] = useState("");
  const [derived, setDerived] = useState("");

  const run = (fn: () => Promise<{ ok?: true; error?: string }>) =>
    start(async () => {
      const r = await fn();
      setMsg(r.error ?? null);
      router.refresh();
    });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-ink-soft underline underline-offset-2 hover:text-ink"
      >
        対応オプションの項目を編集（{options.filter((o) => o.enabled).length}項目: {options.filter((o) => o.enabled).map((o) => o.short ?? o.jp).join(" · ")}）
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">対応オプションの項目</h3>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-ink-soft hover:underline">
          閉じる
        </button>
      </div>
      <p className="mb-2 text-[11px] text-ink-soft">
        ここで追加した項目が、価格表の○×列と車両ページの「対応オプション」表に出ます。全ブランド共通です。
        価格列を選ぶと、その列に金額かASKが入っている車両は自動で〇になります（手動設定が優先）。
      </p>

      <div className="mb-3 overflow-x-auto">
        <table className="w-full min-w-[640px] text-xs">
          <thead className="bg-surface-2 text-left">
            <tr>
              <th className="px-2 py-1.5">順</th>
              <th className="px-2 py-1.5">日本語名</th>
              <th className="px-2 py-1.5">英語名</th>
              <th className="px-2 py-1.5">短縮</th>
              <th className="px-2 py-1.5">価格列から自動</th>
              <th className="px-2 py-1.5">表示</th>
              <th className="px-2 py-1.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {options.map((o, i) => (
              <tr key={o.id}>
                <td className="whitespace-nowrap px-2 py-1">
                  <button type="button" disabled={pending || i === 0} onClick={() => run(() => moveOptionDef(o.id, "up"))} className="px-1 disabled:opacity-30">
                    ↑
                  </button>
                  <button
                    type="button"
                    disabled={pending || i === options.length - 1}
                    onClick={() => run(() => moveOptionDef(o.id, "down"))}
                    className="px-1 disabled:opacity-30"
                  >
                    ↓
                  </button>
                </td>
                <td className="px-2 py-1">
                  <TextCell value={o.jp} disabled={pending} onSave={(v) => run(() => updateOptionDef(o.id, { labelJa: v }))} />
                </td>
                <td className="px-2 py-1">
                  <TextCell value={o.en} disabled={pending} onSave={(v) => run(() => updateOptionDef(o.id, { labelEn: v }))} />
                </td>
                <td className="px-2 py-1">
                  <TextCell value={o.short ?? ""} w="w-16" disabled={pending} onSave={(v) => run(() => updateOptionDef(o.id, { shortLabel: v || null }))} />
                </td>
                <td className="px-2 py-1">
                  <select
                    value={o.derivedFrom ?? ""}
                    disabled={pending}
                    onChange={(e) => run(() => updateOptionDef(o.id, { derivedFrom: e.target.value || null }))}
                    className="rounded border border-line bg-surface px-1 py-0.5 text-[11px]"
                  >
                    <option value="">（手動で設定）</option>
                    {priceColumns.map((c) => (
                      <option key={c.key} value={c.key}>
                        {c.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="px-2 py-1">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => run(() => updateOptionDef(o.id, { enabled: !o.enabled }))}
                    className={`rounded px-2 py-0.5 text-[11px] ${o.enabled ? "bg-emerald-100 text-emerald-800" : "bg-surface-2 text-ink-soft"}`}
                  >
                    {o.enabled ? "表示" : "非表示"}
                  </button>
                </td>
                <td className="px-2 py-1 text-right">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => {
                      if (confirm(`「${o.jp}」を削除しますか？（各車両の設定値は残りますが、ページには出なくなります）`)) {
                        run(() => deleteOptionDef(o.id));
                      }
                    }}
                    className="text-ink-soft hover:text-red-600"
                  >
                    削除
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded border border-line bg-surface-2 p-2">
        <p className="mb-1.5 text-[11px] font-semibold">項目を追加</p>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="日本語名">
            <input
              value={ja}
              onChange={(e) => setJa(e.target.value)}
              placeholder="例: 排気バルブ制御"
              className="w-44 rounded border border-line px-2 py-1 text-sm"
            />
          </Field>
          <Field label="英語名">
            <input
              value={en}
              onChange={(e) => {
                setEn(e.target.value);
                if (!key.trim()) setKey(suggestOptionKey(e.target.value));
              }}
              placeholder="例: Exhaust Valve Control"
              className="w-48 rounded border border-line px-2 py-1 text-sm"
            />
          </Field>
          <Field label="短縮（列見出し）">
            <input value={short} onChange={(e) => setShort(e.target.value)} placeholder="例: 排気弁" className="w-24 rounded border border-line px-2 py-1 text-sm" />
          </Field>
          <Field label="キー（英数字・自動）">
            <input value={key} onChange={(e) => setKey(e.target.value)} className="w-40 rounded border border-line px-2 py-1 text-sm" />
          </Field>
          <Field label="価格列から自動判定">
            <select value={derived} onChange={(e) => setDerived(e.target.value)} className="rounded border border-line bg-surface px-2 py-1 text-sm">
              <option value="">（手動で設定）</option>
              {priceColumns.map((c) => (
                <option key={c.key} value={c.key}>
                  {c.label}
                </option>
              ))}
            </select>
          </Field>
          <button
            type="button"
            disabled={pending || !ja.trim() || !en.trim() || !key.trim()}
            onClick={() =>
              run(async () => {
                const r = await createOptionDef({ key, labelJa: ja, labelEn: en, shortLabel: short, derivedFrom: derived });
                if (!r.error) {
                  setJa("");
                  setEn("");
                  setShort("");
                  setKey("");
                  setDerived("");
                }
                return r;
              })
            }
            className="rounded bg-gold-500 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40"
          >
            追加
          </button>
        </div>
      </div>
      {msg && <p className="mt-2 text-xs text-red-600">{msg}</p>}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[10px] text-ink-soft">{label}</span>
      {children}
    </label>
  );
}

function TextCell({ value, onSave, disabled, w = "w-40" }: { value: string; onSave: (v: string) => void; disabled: boolean; w?: string }) {
  const [v, setV] = useState(value);
  return (
    <input
      value={v}
      disabled={disabled}
      onChange={(e) => setV(e.target.value)}
      onBlur={() => {
        if (v !== value) onSave(v);
      }}
      className={`${w} rounded border border-transparent px-1 py-0.5 text-xs hover:border-line focus:border-gold-500 focus:outline-none`}
    />
  );
}
