"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { exportBrandCsv, generateBrandHtml, importBrandCsv, previewWpSync, publishWpSync } from "@/lib/actions/prices";
import type { BrandRow } from "@/lib/prices/types";
import type { SyncResult } from "@/server/prices/wp-sync";

// 公開HTML（プレビュー・コピー・DL）と CSV入出力
export function PublishPanel({ brand }: { brand: BrandRow }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [html, setHtml] = useState<string | null>(null);
  const [filename, setFilename] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [sync, setSync] = useState<SyncResult | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [force, setForce] = useState(false);

  const runPreview = () =>
    start(async () => {
      setSyncMsg(null);
      setSync(null);
      const r = await previewWpSync(brand.id);
      if (r.error || !r.result) {
        setSyncMsg(r.error ?? "プレビューに失敗しました");
        return;
      }
      setSync(r.result);
      if (r.result.error) setSyncMsg(r.result.error);
    });

  const runPublish = () =>
    start(async () => {
      setSyncMsg(null);
      const r = await publishWpSync(brand.id, force);
      if (r.error || !r.result) {
        setSyncMsg(r.error ?? "同期に失敗しました");
        return;
      }
      const res = r.result;
      setSync(null);
      setForce(false);
      setSyncMsg(
        res.status === "success"
          ? "✅ WordPressに反映しました（公開ページを確認してください）"
          : res.status === "skipped"
            ? "変更なし（前回の反映内容と同一のためスキップしました）"
            : `❌ 反映失敗: ${res.error ?? "不明なエラー"}（WPは変更されていません）`,
      );
      router.refresh();
    });

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

      {/* WordPress同期: 差分プレビュー → 確定で即時反映 */}
      <div className="mt-3 rounded-lg border border-line bg-surface-2/50 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold">
            WordPress同期
            {brand.wordPressPageId ? (
              <span className="ml-1 font-normal text-ink-soft">（ページID: {brand.wordPressPageId}）</span>
            ) : (
              <span className="ml-1 font-normal text-amber-600">— ページID未設定</span>
            )}
          </span>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              disabled={pending || !brand.wordPressPageId}
              onClick={runPreview}
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold text-ink-soft hover:bg-surface-2 disabled:opacity-50"
            >
              差分プレビュー
            </button>
            {sync && sync.status === "dry-run" && !sync.error && (
              <button
                type="button"
                disabled={pending}
                onClick={runPublish}
                className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
              >
                {pending ? "反映中…" : "WordPressへ反映（確定）"}
              </button>
            )}
          </div>
        </div>
        {sync && sync.status === "dry-run" && (
          <div className="mt-2 space-y-1.5">
            {sync.brands.map((b) => (
              <div key={b.brandId} className="text-xs">
                <span className={b.found ? (b.changed ? "text-amber-700" : "text-emerald-700") : "text-red-600"}>
                  {b.found ? (b.changed ? "🔶 差分あり" : "✅ 変更なし") : "❌ ブロック未検出"}
                </span>{" "}
                <span className="font-semibold">{b.displayName}</span>
                <span className="text-ink-soft">
                  {" "}
                  （現{(b.oldBytes / 1024).toFixed(0)}KB → 新{(b.newBytes / 1024).toFixed(0)}KB）
                </span>
                {b.excerpt && (
                  <pre className="mt-1 overflow-x-auto rounded bg-surface p-2 text-[10px] leading-4 text-ink-soft">{b.excerpt}</pre>
                )}
              </div>
            ))}
            {sync.brands.some((b) => b.changed) ? (
              <p className="text-xs text-ink-soft">
                「WordPressへ反映（確定）」で公開ページを即時更新します。反映前の内容は自動でバックアップされます。
              </p>
            ) : (
              <label className="flex items-center gap-1.5 text-xs text-ink-soft">
                <input type="checkbox" checked={force} onChange={(e) => setForce(e.target.checked)} />
                変更なしでも強制再送する（WP側を手で編集してしまった時の復旧用）
              </label>
            )}
            {sync.lastSync && (
              <p className="text-[10px] text-ink-soft">前回反映: {new Date(sync.lastSync.at).toLocaleString("ja-JP")}</p>
            )}
          </div>
        )}
        {syncMsg && <p className="mt-2 text-xs text-ink-soft">{syncMsg}</p>}
      </div>

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
