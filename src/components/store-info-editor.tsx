"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  STORE_META_FIELDS,
  validateStoreInfo,
  type StoreInfo,
  type StoreMetaField,
} from "@/server/pit/store-meta";
import {
  previewStoreInfo,
  commitStoreInfo,
  runStoreSync,
  previewMyStoreInfo,
  commitMyStoreInfo,
  type StorePreview,
} from "@/lib/actions/pit";

export type StoreInfoTarget = {
  id: string;
  displayName: string;
  slug: string;
  active: boolean;
  info: StoreInfo;
  contactPerson: string;
  internalNote: string;
};

// 店舗情報（HP表示内容）の編集フォーム。
// 保存 → 差分プレビュー（WP現在値→新値・反映先URL・送信ペイロード）→ 確定で即時同期。
// フォーム項目は STORE_META_FIELDS（マッピング定義）から生成 = 定義と画面が絶対にズレない。
// scope="hq": 本部（任意店舗・アプリ専用項目・dry-run/再同期あり）
// scope="self": 加盟店（自分の店舗のみ・9項目だけ・slug/店舗名は変更不可）
export function StoreInfoEditor({
  store,
  onClose,
  scope = "hq",
}: {
  store: StoreInfoTarget;
  onClose?: () => void;
  scope?: "hq" | "self";
}) {
  const isHq = scope === "hq";
  const router = useRouter();
  const [info, setInfo] = useState<StoreInfo>(store.info);
  const [contactPerson, setContactPerson] = useState(store.contactPerson);
  const [internalNote, setInternalNote] = useState(store.internalNote);
  const [errors, setErrors] = useState<Partial<Record<string, string>>>({});
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<StorePreview | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const set = (field: StoreMetaField, v: string) => setInfo((old) => ({ ...old, [field]: v }));

  const doPreview = async () => {
    const errs = validateStoreInfo(info);
    setErrors(errs);
    if (Object.keys(errs).length > 0) return;
    setBusy(true);
    setResult(null);
    try {
      const p = isHq ? await previewStoreInfo(store.id, info) : await previewMyStoreInfo(info);
      if (p.error) {
        setErrors(p.fieldErrors ?? {});
        setResult(`エラー: ${p.error}`);
      } else {
        setPreview(p);
      }
    } catch {
      setResult("通信エラーが発生しました");
    } finally {
      setBusy(false);
    }
  };

  const doCommit = async () => {
    setBusy(true);
    try {
      const r = isHq
        ? await commitStoreInfo(store.id, info, { contactPerson, internalNote })
        : await commitMyStoreInfo(info);
      setPreview(null);
      if (r.error) setResult(`エラー: ${r.error}`);
      else if (r.sync?.status === "success") setResult("✓ 保存し、WordPressへ反映しました");
      else if (r.sync?.status === "skipped") setResult("✓ 保存しました（WP側と同一内容のため送信なし）");
      else if (r.sync?.status === "blocked") setResult(`✓ 保存しました（同期対象外: ${r.sync?.error ?? ""}）`);
      else setResult(`保存しましたが同期に失敗しました: ${r.sync?.error ?? "不明"} — 下の「再同期」で再試行できます`);
      router.refresh();
    } catch {
      setResult("通信エラーが発生しました");
    } finally {
      setBusy(false);
    }
  };

  const doDryRun = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await runStoreSync(store.id, true);
      setResult(
        r.status === "dry-run"
          ? `dry-run: 差分 ${r.diffs?.length ?? 0} 項目（WPは変更していません）`
          : `dry-run不可: ${r.error ?? r.status}`,
      );
    } finally {
      setBusy(false);
    }
  };

  const doResync = async () => {
    setBusy(true);
    setResult(null);
    try {
      const r = await runStoreSync(store.id, false);
      setResult(r.status === "success" ? "✓ 再同期しました" : `再同期失敗: ${r.error ?? r.status}`);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-gold-300 bg-surface-2 p-3">
      <div className="mb-2 flex items-center gap-2">
        <h4 className="text-xs font-semibold">
          店舗情報（HP表示）: {store.displayName} <span className="font-mono text-ink-soft">/mbpit/{store.slug}/</span>
        </h4>
        {onClose && (
          <button type="button" onClick={onClose} className="ml-auto text-xs text-ink-soft hover:underline">
            閉じる
          </button>
        )}
      </div>
      {!store.active && (
        <p className="mb-2 text-[11px] text-amber-700">この店舗は停止中のため、保存してもWordPressへは同期されません。</p>
      )}
      <div className="grid gap-2 md:grid-cols-2">
        {STORE_META_FIELDS.map(({ field, label, maxLen, placeholder }) => (
          <label key={field} className={`block text-[11px] text-ink-soft ${field === "intro" ? "md:col-span-2" : ""}`}>
            {label}
            {field === "intro" ? (
              <textarea
                value={info[field]}
                rows={3}
                maxLength={maxLen}
                onChange={(e) => set(field, e.target.value)}
                className="mt-0.5 w-full rounded border border-line bg-surface px-2 py-1 text-xs"
              />
            ) : (
              <input
                value={info[field]}
                maxLength={maxLen}
                placeholder={placeholder}
                onChange={(e) => set(field, e.target.value)}
                className="mt-0.5 w-full rounded border border-line bg-surface px-2 py-1 text-xs"
              />
            )}
            {errors[field] && <span className="mt-0.5 block text-red-600">{errors[field]}</span>}
          </label>
        ))}
        {isHq && (
          <>
            <label className="block text-[11px] text-ink-soft">
              担当者名（アプリ内のみ・WPへ送信しない）
              <input
                value={contactPerson}
                onChange={(e) => setContactPerson(e.target.value)}
                className="mt-0.5 w-full rounded border border-line bg-surface px-2 py-1 text-xs"
              />
            </label>
            <label className="block text-[11px] text-ink-soft">
              社内メモ（アプリ内のみ・WPへ送信しない）
              <textarea
                value={internalNote}
                rows={2}
                onChange={(e) => setInternalNote(e.target.value)}
                className="mt-0.5 w-full rounded border border-line bg-surface px-2 py-1 text-xs"
              />
            </label>
          </>
        )}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={doPreview}
          className="rounded-lg bg-gold-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
        >
          保存（差分プレビュー）
        </button>
        {isHq && (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={doDryRun}
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold hover:bg-surface disabled:opacity-50"
            >
              dry-run（保存済みデータで差分確認）
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={doResync}
              className="rounded-lg border border-line px-3 py-1.5 text-xs font-semibold hover:bg-surface disabled:opacity-50"
            >
              再同期
            </button>
          </>
        )}
        {result && <span className="text-xs">{result}</span>}
      </div>

      {/* 差分プレビュー（確定するまでWP・DBとも未変更） */}
      {preview && (
        <div className="mt-3 rounded-lg border border-line bg-surface p-3">
          <h5 className="text-xs font-bold">変更内容の確認 — {store.displayName}</h5>
          {preview.willSync === false && (
            <p className="mt-1 text-[11px] text-amber-700">{preview.syncBlockReason}</p>
          )}
          {(preview.diffs?.length ?? 0) === 0 ? (
            <p className="mt-1 text-xs text-ink-soft">WordPress側との差分はありません（保存のみ行います）。</p>
          ) : (
            <table className="mt-2 w-full text-xs">
              <thead className="text-left text-[11px] text-ink-soft">
                <tr><th className="py-1">項目</th><th>現在（WP）</th><th>変更後</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {preview.diffs!.map((d) => (
                  <tr key={d.metaKey}>
                    <td className="py-1 font-semibold">{d.label}</td>
                    <td className="text-ink-soft">{d.oldValue || "（未設定）"}</td>
                    <td>{d.newValue || <span className="text-red-600">（削除 → 表示から消えます）</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="mt-2 text-[11px] text-ink-soft">
            反映先: {preview.targets?.map((t) => (
              <a key={t.url} href={t.url} target="_blank" rel="noopener" className="mr-2 text-sky-700 hover:underline">
                {t.label}
              </a>
            ))}
            （店舗ページ・ポータルカード・記事下カードに反映）
          </p>
          <details className="mt-1 text-[11px] text-ink-soft">
            <summary className="cursor-pointer">送信ペイロード（dry-run表示）</summary>
            <pre className="mt-1 overflow-x-auto rounded bg-surface-2 p-2 text-[10px]">{JSON.stringify(preview.payload, null, 2)}</pre>
          </details>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={doCommit}
              className="rounded-lg bg-gold-500 px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50"
            >
              {busy ? "反映中…" : "確定して反映"}
            </button>
            <button type="button" onClick={() => setPreview(null)} className="text-xs text-ink-soft hover:underline">
              戻る
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
