"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui";
import { listMyGbpLocations, selectMyGbpLocation, disconnectMyGbp } from "@/lib/actions/pit-gbp-self";

type Loc = { accountId: string; locationId: string; title: string; address: string };

/*
 * 方式B の操作パネル。
 *
 * 拠点は**必ず店主が選ぶ**。候補が1件でも自動確定しない（別アカウントに紛れた
 * 別店舗を勝手に選ばないため）。選択後も投稿は本部が有効化するまで飛ばない。
 */
export function GbpSelfClient({
  connected,
  authEmail,
  selectedLocationId,
  selectedName,
  selectedAddr,
  revoked,
}: {
  connected: boolean;
  authEmail: string;
  selectedLocationId: string | null;
  selectedName: string;
  selectedAddr: string;
  revoked: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [locs, setLocs] = useState<Loc[] | null>(null);
  const [msg, setMsg] = useState("");
  const [needsReauth, setNeedsReauth] = useState(revoked);

  const load = () =>
    start(async () => {
      setMsg("");
      const r = await listMyGbpLocations();
      if (r.error) {
        setMsg(r.error);
        setNeedsReauth(Boolean(r.needsReauth));
        return;
      }
      setLocs(r.locations ?? []);
      if ((r.locations ?? []).length === 0) {
        setMsg(
          "このGoogleアカウントで管理している店舗が見つかりませんでした。お店のオーナー権限があるアカウントでログインし直してください。",
        );
      }
    });

  const choose = (l: Loc) =>
    start(async () => {
      const r = await selectMyGbpLocation(l);
      setMsg(r.error ?? `「${l.title}」を連携しました。`);
      if (r.ok) {
        setLocs(null);
        router.refresh();
      }
    });

  const disconnect = () => {
    if (!window.confirm("Googleマップとの連携を解除しますか？\n解除するとGoogleマップへの投稿は止まります。")) return;
    start(async () => {
      const r = await disconnectMyGbp();
      setMsg(r.error ?? "連携を解除しました。");
      if (r.ok) {
        setLocs(null);
        setNeedsReauth(false);
        router.refresh();
      }
    });
  };

  return (
    <Card>
      <h3 className="text-sm font-bold text-ink">Googleマップと連携する</h3>

      {!connected || needsReauth ? (
        <>
          <p className="mt-1 text-xs leading-relaxed text-ink-soft">
            お店のGoogleアカウントでログインすると、ご自身で連携できます。
            {needsReauth && (
              <span className="font-bold text-amber-700">
                <br />
                連携が切れています。お手数ですが、もう一度連携してください。
              </span>
            )}
          </p>
          <a
            href="/api/pit/gbp/oauth/start"
            className="mt-3 inline-flex items-center gap-2 rounded-lg border border-line bg-white px-4 py-2.5 text-sm font-bold text-ink shadow-sm hover:bg-gray-50"
          >
            <span className="text-base">🔗</span>
            Googleアカウントで連携する
          </a>
          <p className="mt-2 text-[11px] leading-relaxed text-ink-soft">
            ログイン時に、Googleビジネスプロフィールへのアクセス許可を求められます。
            許可する範囲はお店のプロフィールの管理のみで、Gmailや他のデータにはアクセスしません。
          </p>
        </>
      ) : (
        <>
          <div className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
            <div className="text-xs font-bold text-emerald-900">Googleと連携済み</div>
            <div className="mt-0.5 break-all text-[11px] text-emerald-800">{authEmail || "（アカウント不明）"}</div>
          </div>

          {selectedLocationId ? (
            <div className="mt-3 rounded-lg border border-line bg-white p-3">
              <div className="text-[11px] text-ink-soft">投稿先の店舗</div>
              <div className="mt-0.5 text-sm font-bold text-ink">{selectedName}</div>
              <div className="text-[11px] text-ink-soft">{selectedAddr}</div>
            </div>
          ) : (
            <p className="mt-3 text-xs font-bold text-amber-700">
              投稿先の店舗がまだ選ばれていません。下のボタンから選んでください。
            </p>
          )}

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={load}
              disabled={pending}
              className="rounded-lg bg-ink px-3 py-2 text-xs font-bold text-white disabled:opacity-50"
            >
              {selectedLocationId ? "投稿先を変更する" : "店舗を選ぶ"}
            </button>
            <button
              type="button"
              onClick={disconnect}
              disabled={pending}
              className="rounded-lg border border-line px-3 py-2 text-xs font-bold text-ink-soft disabled:opacity-50"
            >
              連携を解除
            </button>
          </div>

          {locs && locs.length > 0 && (
            <div className="mt-3 space-y-2">
              <p className="text-[11px] text-ink-soft">
                投稿先にする店舗を選んでください（複数の店舗をお持ちの場合はご注意ください）。
              </p>
              {locs.map((l) => {
                const current = l.locationId === selectedLocationId;
                return (
                  <button
                    key={l.locationId}
                    type="button"
                    onClick={() => choose(l)}
                    disabled={pending || current}
                    className={`block w-full rounded-lg border p-3 text-left disabled:opacity-60 ${
                      current ? "border-emerald-300 bg-emerald-50" : "border-line bg-white hover:bg-gray-50"
                    }`}
                  >
                    <div className="text-sm font-bold text-ink">{l.title || "(名称なし)"}</div>
                    <div className="text-[11px] text-ink-soft">{l.address || "(住所なし)"}</div>
                    {current && <div className="mt-0.5 text-[11px] font-bold text-emerald-700">選択中</div>}
                  </button>
                );
              })}
            </div>
          )}
        </>
      )}

      {msg && <p className="mt-3 rounded-lg bg-gray-50 px-3 py-2 text-xs text-ink">{msg}</p>}
    </Card>
  );
}
