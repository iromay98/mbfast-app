"use client";

// 新しいメーカーを価格表に追加する。列の並びや同期の仕組みは既存ブランドから複製するので、
// 追加後すぐに「車両を追加 → 価格入力 → WPへ反映」の流れがそのまま使える。

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui";
import { createBrand } from "@/lib/actions/prices";

export function AddBrand({ brands }: { brands: { id: string; displayName: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [slug, setSlug] = useState("");
  const [copyFrom, setCopyFrom] = useState(brands[0]?.id ?? "");
  const [wpPageId, setWpPageId] = useState("");

  const autoFill = (v: string) => {
    setName(v);
    const key = v
      .toLowerCase()
      .normalize("NFKC")
      .replace(/[^a-z0-9]+/g, "");
    if (key) {
      setId((cur) => cur || key);
      setSlug((cur) => cur || key);
    }
  };

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-dashed border-line px-3 py-1.5 text-xs text-ink-soft hover:bg-surface-2"
      >
        ＋ メーカーを追加
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">メーカーを追加</h3>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-ink-soft hover:underline">
          閉じる
        </button>
      </div>
      <p className="mb-2 text-[11px] text-ink-soft">
        列の構成・CSV形式・表の版面はコピー元から複製されます。WPページIDは後からブランド設定で登録してもかまいません。
      </p>
      <div className="flex flex-wrap items-end gap-2">
        <Field label="表示名">
          <input
            value={name}
            onChange={(e) => autoFill(e.target.value)}
            placeholder="例: プジョー"
            className="w-36 rounded border border-line px-2 py-1 text-sm"
          />
        </Field>
        <Field label="ID（半角英字）">
          <input
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="peugeot"
            className="w-32 rounded border border-line px-2 py-1 text-sm"
          />
        </Field>
        <Field label="slug（URL用）">
          <input
            value={slug}
            onChange={(e) => setSlug(e.target.value)}
            placeholder="peugeot"
            className="w-32 rounded border border-line px-2 py-1 text-sm"
          />
        </Field>
        <Field label="列をコピーするメーカー">
          <select
            value={copyFrom}
            onChange={(e) => setCopyFrom(e.target.value)}
            className="rounded border border-line bg-surface px-2 py-1 text-sm"
          >
            {brands.map((b) => (
              <option key={b.id} value={b.id}>
                {b.displayName}
              </option>
            ))}
          </select>
        </Field>
        <Field label="WPページID（任意）">
          <input
            value={wpPageId}
            inputMode="numeric"
            onChange={(e) => setWpPageId(e.target.value)}
            placeholder="後で可"
            className="w-24 rounded border border-line px-2 py-1 text-sm"
          />
        </Field>
        <Button
          disabled={pending || !name.trim() || !id.trim() || !slug.trim() || !copyFrom}
          onClick={() =>
            start(async () => {
              const n = Number(wpPageId.replace(/[^0-9]/g, ""));
              const r = await createBrand({
                id: id.trim(),
                displayName: name.trim(),
                slug: slug.trim(),
                namespacePrefix: slug.trim(),
                copyColumnsFromBrandId: copyFrom,
                wordPressPageId: Number.isFinite(n) && n > 0 ? n : null,
              });
              if (r.error) {
                setMsg(r.error);
                return;
              }
              setMsg(`${name} を追加しました`);
              setName("");
              setId("");
              setSlug("");
              setWpPageId("");
              router.refresh();
            })
          }
        >
          {pending ? "追加中…" : "追加"}
        </Button>
      </div>
      {msg && <p className="mt-2 text-xs text-ink-soft">{msg}</p>}
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
