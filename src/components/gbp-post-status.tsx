"use client";
import { useState, useTransition } from "react";
import { fetchGbpPostStates } from "@/lib/actions/pit-gbp";

/*
 * マップ投稿の実状態（Google側）を見る画面部品。
 *
 * DBの「投稿済み」とマップでの「表示中」は別物: GBPは受理後に審査が走り、
 * PROCESSING（審査中）の間はマップに出ない。REJECTED なら出ないまま終わる。
 * 「投稿したのに出ていない」の問い合わせがここで自己解決できるようにする。
 *
 * 状態はボタンを押したときだけGoogleへ問い合わせる（自動更新しない）。
 * 割り当ての節約と、待たされ画面を作らないため。
 */

const STATE_LABEL: Record<string, { text: string; cls: string; hint?: string }> = {
  LIVE: { text: "公開中", cls: "bg-green-100 text-green-800" },
  PROCESSING: {
    text: "審査中",
    cls: "bg-amber-100 text-amber-800",
    hint: "Googleの審査中です。写真付きは数時間かかることがあります",
  },
  REJECTED: {
    text: "非公開（審査落ち）",
    cls: "bg-red-100 text-red-700",
    hint: "Googleの審査で非表示になりました。文面を直して出し直してください",
  },
  NOT_FOUND: {
    text: "見つからない",
    cls: "bg-neutral-200 text-neutral-700",
    hint: "削除済みか、Google側の一覧に載っていません",
  },
  FAILED: { text: "投稿失敗", cls: "bg-red-100 text-red-700" },
  UNKNOWN: { text: "不明", cls: "bg-neutral-200 text-neutral-700" },
};

type Row = NonNullable<Awaited<ReturnType<typeof fetchGbpPostStates>>["rows"]>[number];

export function GbpPostStatus() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  return (
    <div>
      <div className="flex items-center justify-between">
        <p className="text-base font-bold text-ink">マップ投稿の状態</p>
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            start(async () => {
              setErr("");
              const r = await fetchGbpPostStates();
              if (r.error) setErr(r.error);
              else setRows(r.rows ?? []);
            })
          }
          className="rounded-lg border border-line px-3 py-1.5 text-xs font-bold text-ink hover:bg-paper disabled:opacity-50"
        >
          {pending ? "Googleに確認中…" : rows ? "再確認" : "Googleに確認する"}
        </button>
      </div>
      <p className="mt-1 text-xs text-ink-soft">
        投稿はGoogleの審査を通ってからマップに表示されます。「審査中」の間は見えません。
      </p>
      {err && <p className="mt-2 text-xs text-red-600">{err}</p>}
      {rows && rows.length === 0 && (
        <p className="mt-3 text-xs text-ink-soft">マップへ送った投稿はまだありません。</p>
      )}
      {rows && rows.length > 0 && (
        <ul className="mt-3 space-y-2">
          {rows.map((r) => {
            const st = STATE_LABEL[r.state] ?? STATE_LABEL.UNKNOWN;
            return (
              <li key={r.postId} className="rounded-lg border border-line p-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-ink">{r.title}</p>
                    <p className="text-[11px] text-ink-soft">
                      {r.storeName}
                      {r.postedAt ? ` ・ ${new Date(r.postedAt).toLocaleString("ja-JP")}` : ""}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${st.cls}`}
                  >
                    {st.text}
                  </span>
                </div>
                {st.hint && <p className="mt-1 text-[11px] text-ink-soft">{st.hint}</p>}
                {r.gbpError && (
                  <p className="mt-1 break-all text-[11px] text-red-600">失敗理由: {r.gbpError}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
