"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card, EmptyState } from "@/components/ui";
import { linkGbpLocation, unlinkGbpLocation, toggleGbpPosting } from "@/lib/actions/pit-gbp";

export type StoreRow = {
  id: string;
  displayName: string;
  slug: string;
  address: string;
  active: boolean;
  gbpAccountId: string;
  gbpLocationId: string | null;
  gbpLocationName: string;
  gbpLocationAddr: string;
  gbpLinkedAt: string;
  gbpPostingEnabled: boolean;
  /** GBP_LOCATION_MAP による手動指定（DBの紐付けが無いときの投稿先） */
  manualLocationId: string | null;
};

export type LocationRow = {
  name: string;
  title: string;
  address: string;
  phone?: string;
  accountId: string;
  accountName: string;
  linkedStore: { id: string; displayName: string } | null;
};

/*
 * 紐付けUI。**選ぶのは人**。
 * 店舗を選ぶ → ロケーションを選ぶ → 住所を並べて表示 → 確認して確定、の順で進む。
 * 名前が似ているからといって候補を上に出したり自動選択したりしない（誤配信の元）。
 */
export function GbpLinkClient({ stores, locations }: { stores: StoreRow[]; locations: LocationRow[] }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [storeId, setStoreId] = useState("");
  const [locationId, setLocationId] = useState("");

  const store = stores.find((s) => s.id === storeId) ?? null;
  const location = locations.find((l) => l.name === locationId) ?? null;

  const run = (fn: () => Promise<{ ok?: true; error?: string }>, okMessage: string) =>
    startTransition(async () => {
      setError(null);
      setDone(null);
      const r = await fn();
      if (r.error) setError(r.error);
      else {
        setDone(okMessage);
        setStoreId("");
        setLocationId("");
        router.refresh();
      }
    });

  return (
    <div className="space-y-3">
      {error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>}
      {done && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">{done}</p>}

      {/* 紐付け */}
      <Card>
        <h3 className="text-sm font-bold text-ink">ロケーションを店舗に割り当てる</h3>
        {locations.length === 0 ? (
          <p className="mt-1 text-xs text-ink-soft">
            取得できたロケーションがありません。加盟店側で mbFAST を管理者に招待し、承諾されているかご確認ください。
          </p>
        ) : (
          <>
            <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
              <label className="block text-[11px] font-semibold text-ink-soft">
                mbPIT店舗
                <select
                  value={storeId}
                  onChange={(e) => setStoreId(e.target.value)}
                  className="mt-0.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink"
                >
                  <option value="">選択してください</option>
                  {stores.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.displayName}
                      {s.gbpLocationId ? "（紐付け済み）" : ""}
                      {s.active ? "" : "・停止中"}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-[11px] font-semibold text-ink-soft">
                Googleのロケーション
                <select
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                  className="mt-0.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink"
                >
                  <option value="">選択してください</option>
                  {locations.map((l) => (
                    <option key={l.name} value={l.name}>
                      {l.title}
                      {l.linkedStore ? `（${l.linkedStore.displayName} に割当済）` : ""}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {/* 住所の見比べ。ここが誤配信を止める最後の砦なので必ず両方出す */}
            {(store || location) && (
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="rounded-lg bg-surface-2 p-2 text-xs">
                  <p className="font-bold text-ink">mbPIT側</p>
                  <p className="mt-0.5 text-ink">{store?.displayName ?? "—"}</p>
                  <p className="text-ink-soft">{store?.address || "（住所が未登録）"}</p>
                </div>
                <div className="rounded-lg bg-surface-2 p-2 text-xs">
                  <p className="font-bold text-ink">Google側</p>
                  <p className="mt-0.5 text-ink">{location?.title ?? "—"}</p>
                  <p className="text-ink-soft">{location?.address || "（住所なし）"}</p>
                  {location?.phone && <p className="text-ink-soft">{location.phone}</p>}
                  {location && <p className="mt-0.5 font-mono text-[10px] text-ink-soft">{location.name}</p>}
                </div>
              </div>
            )}

            {location?.linkedStore && location.linkedStore.id !== storeId && (
              <p className="mt-2 text-xs font-semibold text-amber-700">
                このロケーションは「{location.linkedStore.displayName}」に割り当て済みです。先に解除してください。
              </p>
            )}

            <button
              type="button"
              disabled={busy || !store || !location || (!!location.linkedStore && location.linkedStore.id !== storeId)}
              onClick={() => {
                if (!store || !location) return;
                if (
                  !window.confirm(
                    `「${store.displayName}」の投稿先を\n${location.title}\n${location.address}\nに設定します。住所が一致していることを確認しましたか？`,
                  )
                )
                  return;
                run(
                  () =>
                    linkGbpLocation({
                      storeId: store.id,
                      accountId: location.accountId,
                      locationId: location.name,
                      locationName: location.title,
                      locationAddr: location.address,
                    }),
                  "紐付けました（投稿はまだ無効です）",
                );
              }}
              className="mt-3 rounded-lg bg-gold-500 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
            >
              {busy ? "保存中…" : "この組み合わせで紐付ける"}
            </button>
          </>
        )}
      </Card>

      {/* 現在の状態 */}
      {stores.length === 0 ? (
        <EmptyState message="店舗がありません。" />
      ) : (
        <Card className="divide-y divide-line p-0">
          {stores.map((s) => (
            <div key={s.id} className="flex flex-wrap items-center gap-2 p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-ink">
                  {s.displayName}
                  {!s.active && <span className="ml-1 text-[11px] text-ink-soft">（停止中）</span>}
                </p>
                {s.gbpLocationId ? (
                  <p className="mt-0.5 truncate text-xs text-ink-soft">
                    {s.gbpLocationName}
                    <span className="ml-2 font-mono text-[10px]">{s.gbpLocationId}</span>
                    {s.gbpLinkedAt && <span className="ml-2">{s.gbpLinkedAt} 紐付け</span>}
                  </p>
                ) : s.manualLocationId ? (
                  <p className="mt-0.5 truncate text-xs text-ink-soft">
                    <span className="rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-bold">環境変数で指定</span>
                    <span className="ml-2 font-mono text-[10px]">{s.manualLocationId}</span>
                  </p>
                ) : (
                  <p className="mt-0.5 text-xs text-ink-soft">未紐付け</p>
                )}
                {/* 手動指定の突き合わせに使うので slug は常に出す */}
                <p className="mt-0.5 font-mono text-[10px] text-ink-soft">slug: {s.slug}</p>
                {s.gbpLocationAddr && <p className="truncate text-[11px] text-ink-soft">{s.gbpLocationAddr}</p>}
              </div>
              <div className="ml-auto flex shrink-0 items-center gap-2">
                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${
                    s.gbpPostingEnabled ? "bg-emerald-100 text-emerald-800" : "bg-surface-2 text-ink-soft"
                  }`}
                >
                  {s.gbpPostingEnabled ? "投稿 有効" : "投稿 無効"}
                </span>
                {(s.gbpLocationId || s.manualLocationId) && (
                  <>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        run(
                          () => toggleGbpPosting(s.id, !s.gbpPostingEnabled),
                          s.gbpPostingEnabled ? "投稿を無効にしました" : "投稿を有効にしました",
                        )
                      }
                      className="rounded-lg border border-line px-2.5 py-1.5 text-[11px] font-semibold text-ink"
                    >
                      {s.gbpPostingEnabled ? "無効にする" : "有効にする"}
                    </button>
                    {s.gbpLocationId && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          if (!window.confirm(`「${s.displayName}」の紐付けを解除します。よろしいですか？`)) return;
                          run(() => unlinkGbpLocation(s.id), "紐付けを解除しました");
                        }}
                        className="text-[11px] text-ink-soft hover:underline"
                      >
                        解除
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
