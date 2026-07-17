"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { exportBrandCsv, generateBrandHtml, importBrandCsv } from "@/lib/actions/prices";
import type { BrandRow } from "@/lib/prices/types";

// 公開HTML（プレビュー・コピー・DL）と CSV入出力
export function PublishPanel({ brand }: { brand: BrandRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [html, setHtml] = useState<string | null>(null);
  const [filename, setFilename] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const gen = () =>
    start(async () => {
      setMsg(null);
      const r = await generateBrandHtml(brand.id);
      if (r.error || !r.html) {
        setMsg(r.error ?? "生成に失敗しました");
        return;
      }
      setHtml(r.html);
      setFilename(r.filename ?? "price_table.html");
    });

  const copy = async () => {
    if (!html) return;
    await navigator.clipboard.writeText(html);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const download = (content: string, name: string, type: string) => {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportCsv = () =>
    start(async () => {
      setMsg(null);
      const r = await exportBrandCsv(brand.id);
      if (r.error || !r.csv) {
        setMsg(r.error ?? "CSV出力に失敗しました");
        return;
      }
      download(r.csv, r.filename ?? "prices.csv", "text/csv;charset=utf-8");
    });

  const importCsv = (file: File) =>
    start(async () => {
      setMsg(null);
      const text = await file.text();
      const r = await importBrandCsv(brand.id, text);
      if (r.error) {
        setMsg(r.error);
        return;
      }
      setMsg(`CSV取込完了: 更新 ${r.updated} 件 / 追加 ${r.created} 件`);
      router.refresh();
    });

  return (
    <div className="rounded-lg border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-sm font-semibold">公開HTML / CSV — {brand.displayName}</h3>
        <div className="ml-auto flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            disabled={pending}
            onClick={gen}
            className="rounded-lg bg-gold-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
          >
            {pending ? "生成中…" : "HTMLを生成"}
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={exportCsv}
            className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-surface-2 disabled:opacity-50"
          >
            CSVエクスポート
          </button>
          <button
            type="button"
            disabled={pending}
            onClick={() => fileRef.current?.click()}
            className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-surface-2 disabled:opacity-50"
          >
            CSVインポート
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) importCsv(f);
              e.target.value = "";
            }}
          />
        </div>
      </div>
      {msg && <p className="mt-2 text-xs text-ink-soft">{msg}</p>}

      {html && (
        <div className="mt-3 space-y-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-ink-soft">
              {filename}（{(html.length / 1024).toFixed(0)} KB）— WordPressの固定ページに全文貼り付け
              {brand.wordPressPageId ? `（ページID: ${brand.wordPressPageId}）` : ""}
            </span>
            <button
              type="button"
              onClick={copy}
              className={`rounded-lg px-3 py-1 text-xs font-semibold text-white ${copied ? "bg-green-600" : "bg-sky-600"}`}
            >
              {copied ? "✓ コピーしました" : "全文コピー"}
            </button>
            <button
              type="button"
              onClick={() => download(html, filename, "text/html;charset=utf-8")}
              className="rounded-lg border border-line px-3 py-1 text-xs font-semibold text-ink-soft hover:bg-surface-2"
            >
              .htmlダウンロード
            </button>
            <button type="button" onClick={() => setHtml(null)} className="text-xs text-ink-soft hover:underline">
              閉じる
            </button>
          </div>
          <iframe
            srcDoc={html}
            sandbox="allow-scripts"
            title={`${brand.displayName} 価格表プレビュー`}
            className="h-[480px] w-full rounded-lg border border-line bg-white"
          />
        </div>
      )}
    </div>
  );
}
