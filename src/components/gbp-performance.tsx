"use client";
import { useState, useTransition } from "react";
import { fetchGbpPerformance } from "@/lib/actions/pit-gbp";

/*
 * 店舗のGoogleマップ・検索での表示実績（本部画面）。
 *
 * mbPITが投稿を自動で流した結果を数字で見せる＝掲載効果の証明。
 * データはGoogle側で数日遅れて反映されるため「傾向を見る」用途と明記する。
 * 取得はボタン押下時のみ（自動ポーリングしない）。
 */

type Store = { id: string; displayName: string };

export function GbpPerformance({ stores }: { stores: Store[] }) {
  const [storeId, setStoreId] = useState(stores[0]?.id ?? "");
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState<{ label: string; total: number }[] | null>(null);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  if (stores.length === 0) {
    return (
      <p className="text-xs text-ink-soft">
        Googleマップと紐付いた店舗がまだありません。紐付けるとここに表示実績が出ます。
      </p>
    );
  }

  const load = (id: string, d: number) =>
    start(async () => {
      setErr("");
      const r = await fetchGbpPerformance(id, d);
      if (r.error) {
        setErr(r.error);
        setRows(null);
      } else setRows(r.rows ?? []);
    });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-auto text-base font-bold text-ink">Googleでの表示実績</p>
        <select
          value={storeId}
          onChange={(e) => setStoreId(e.target.value)}
          className="rounded-lg border border-line bg-transparent px-2 py-1.5 text-xs text-ink"
        >
          {stores.map((s) => (
            <option key={s.id} value={s.id}>
              {s.displayName}
            </option>
          ))}
        </select>
        <select
          value={days}
          onChange={(e) => setDays(Number(e.target.value))}
          className="rounded-lg border border-line bg-transparent px-2 py-1.5 text-xs text-ink"
        >
          <option value={30}>直近30日</option>
          <option value={90}>直近90日</option>
        </select>
        <button
          type="button"
          disabled={pending || !storeId}
          onClick={() => load(storeId, days)}
          className="rounded-lg border border-line px-3 py-1.5 text-xs font-bold text-ink hover:bg-paper disabled:opacity-50"
        >
          {pending ? "取得中…" : "取得"}
        </button>
      </div>
      <p className="mt-1 text-xs text-ink-soft">
        Googleマップ・検索でこの店がどれだけ見られたか。数値は数日遅れで反映されます。
      </p>
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
      {rows && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {rows.map((r) => (
            <div key={r.label} className="rounded-lg border border-line p-2.5 text-center">
              <p className="text-lg font-black text-ink">{r.total.toLocaleString()}</p>
              <p className="text-[11px] text-ink-soft">{r.label}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
