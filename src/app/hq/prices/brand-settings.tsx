"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { updateBrand } from "@/lib/actions/prices";
import type { BrandRow } from "@/lib/prices/types";

// ブランド定義（表示名・導入文・SEO説明・WPページID）。普段は畳んでおく。
export function BrandSettings({ brand }: { brand: BrandRow }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState(brand.displayName);
  const [intro, setIntro] = useState(brand.intro);
  const [jsonLdDescription, setJsonLd] = useState(brand.jsonLdDescription);
  const [wpId, setWpId] = useState(brand.wordPressPageId?.toString() ?? "");

  const save = () =>
    start(async () => {
      const r = await updateBrand(brand.id, {
        displayName,
        intro,
        jsonLdDescription,
        wordPressPageId: wpId.trim() ? Number(wpId.trim()) : null,
      });
      setMsg(r.error ?? "保存しました");
      router.refresh();
    });

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-xs text-ink-soft underline underline-offset-2 hover:text-ink"
      >
        ブランド設定を開く（表示名・導入文・SEO・WordPressページID / 列: {brand.columns.map((c) => c.label).join(" · ")}）
      </button>
    );
  }

  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">ブランド設定 — {brand.displayName}</h3>
        <button type="button" onClick={() => setOpen(false)} className="text-xs text-ink-soft hover:underline">
          閉じる
        </button>
      </div>
      <div className="grid gap-2 md:grid-cols-2">
        <Field label="表示名">
          <input
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            className="w-full rounded border border-line px-2 py-1 text-sm"
          />
        </Field>
        <Field label={`WordPress ページID（スラッグ: ${brand.slug} / 名前空間: ${brand.namespacePrefix}）`}>
          <input
            value={wpId}
            inputMode="numeric"
            placeholder="未設定"
            onChange={(e) => setWpId(e.target.value)}
            className="w-full rounded border border-line px-2 py-1 text-sm font-mono"
          />
        </Field>
        <Field label="導入文（表の上に出る説明）">
          <textarea
            value={intro}
            rows={3}
            onChange={(e) => setIntro(e.target.value)}
            className="w-full rounded border border-line px-2 py-1 text-sm"
          />
        </Field>
        <Field label="SEO説明（JSON-LD description）">
          <textarea
            value={jsonLdDescription}
            rows={3}
            onChange={(e) => setJsonLd(e.target.value)}
            className="w-full rounded border border-line px-2 py-1 text-sm"
          />
        </Field>
      </div>
      <div className="mt-2 flex items-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={save}
          className="rounded-lg bg-gold-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          {pending ? "保存中…" : "保存"}
        </button>
        {msg && <span className="text-xs text-ink-soft">{msg}</span>}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-0.5 block text-[11px] text-ink-soft">{label}</span>
      {children}
    </label>
  );
}
