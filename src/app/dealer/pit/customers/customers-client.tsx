"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Card, EmptyState } from "@/components/ui";
import { upsertPitCustomer, deletePitCustomer, type CustomerInput } from "@/lib/actions/pit-customers";
import { VehicleEditPanel } from "../vehicles/vehicle-edit-panel";

export type CustomerVehicle = {
  vehicleId: string;
  vehicleName: string;
  maker: string;
  modelCode: string;
  chassisLast3: string;
  inspectionExpiry: string; // "" | YYYY-MM-DD
};

export type CustomerRow = {
  id: string;
  name: string;
  kana: string;
  tel: string;
  vehicleName: string;
  inspectionExpiry: string; // "" | YYYY-MM-DD
  note: string;
  address: string;
  email: string;
  /** 登録済みの車両（この場で修正・証明書作成ができる） */
  vehicles: CustomerVehicle[];
};

const input = "mt-0.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink";
const label = "block text-[11px] font-semibold text-ink-soft";

function daysLeft(ymd: string): number | null {
  if (!ymd) return null;
  const d = new Date(`${ymd}T00:00:00+09:00`).getTime() - Date.now();
  return Math.ceil(d / (24 * 60 * 60 * 1000));
}

// 顧客カルテ: 一覧（車検が近い順・検索）＋追加/編集フォーム＋削除
export function CustomersClient({ customers }: { customers: CustomerRow[] }) {
  const router = useRouter();
  const [editing, setEditing] = useState<Partial<CustomerRow> | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // カルテの中から車両情報を直す（車両登録をやり直させない）
  const [editVehicleId, setEditVehicleId] = useState<string | null>(null);

  const filtered = q.trim()
    ? customers.filter((c) =>
        [c.name, c.kana, c.tel, c.vehicleName, c.note].some((v) => v.includes(q.trim())),
      )
    : customers;

  const save = async () => {
    if (!editing) return;
    setBusy(true);
    setError(null);
    try {
      const r = await upsertPitCustomer({
        id: editing.id,
        name: editing.name ?? "",
        kana: editing.kana ?? "",
        tel: editing.tel ?? "",
        vehicleName: editing.vehicleName ?? "",
        inspectionExpiry: editing.inspectionExpiry ?? "",
        note: editing.note ?? "",
        address: editing.address ?? "",
        email: editing.email ?? "",
      } satisfies CustomerInput);
      if (r.error) setError(r.error);
      else {
        setEditing(null);
        router.refresh();
      }
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c: CustomerRow) => {
    if (!window.confirm(`${c.name} 様のカルテを削除しますか？（元に戻せません）`)) return;
    setBusy(true);
    try {
      await deletePitCustomer(c.id);
      setEditing(null);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="🔍 名前・車両・電話で検索"
          className="w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm"
        />
        <button
          type="button"
          onClick={() => setEditing({})}
          className="shrink-0 rounded-lg bg-gold-500 px-3 py-2 text-sm font-bold text-white"
        >
          ＋ 追加
        </button>
      </div>

      {/* 車検証から登録すると、車台番号・型式・車検満了日・使用者の氏名住所までまとめて入る */}
      <Link
        href="/dealer/pit/vehicles"
        className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2.5 text-sm font-semibold text-ink"
      >
        📷 車検証を撮って車両を登録
        <span className="ml-auto text-[11px] font-normal text-ink-soft">証明書に必要な情報が入ります</span>
      </Link>

      {done && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">{done}</p>
      )}

      {/* 車両情報の修正（車両登録画面と同じパネル） */}
      {editVehicleId && (
        <VehicleEditPanel
          key={editVehicleId}
          vehicleId={editVehicleId}
          onClose={() => setEditVehicleId(null)}
          onSaved={(m) => {
            setDone(m);
            setEditVehicleId(null);
            router.refresh();
          }}
        />
      )}

      {/* 追加・編集フォーム */}
      {editing && (
        <Card className="border-gold-300">
          <h3 className="mb-2 text-sm font-bold text-ink">{editing.id ? "カルテを編集" : "お客様を登録"}</h3>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className={label}>
              お名前 <span className="text-red-600">必須</span>
              <input
                value={editing.name ?? ""}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                placeholder="山田 太郎"
                className={input}
              />
            </label>
            <label className={label}>
              ふりがな
              <input
                value={editing.kana ?? ""}
                onChange={(e) => setEditing({ ...editing, kana: e.target.value })}
                placeholder="やまだ たろう"
                className={input}
              />
            </label>
            <label className={label}>
              電話番号
              <input
                value={editing.tel ?? ""}
                onChange={(e) => setEditing({ ...editing, tel: e.target.value })}
                inputMode="tel"
                placeholder="090-0000-0000"
                className={input}
              />
            </label>
            <label className={label}>
              車両
              <input
                value={editing.vehicleName ?? ""}
                onChange={(e) => setEditing({ ...editing, vehicleName: e.target.value })}
                placeholder="アルファード 30系"
                className={input}
              />
            </label>
            <label className={label}>
              車検満了日
              <input
                value={editing.inspectionExpiry ?? ""}
                onChange={(e) => setEditing({ ...editing, inspectionExpiry: e.target.value })}
                type="date"
                className={input}
              />
            </label>
            <label className={label}>
              メール
              <input
                value={editing.email ?? ""}
                onChange={(e) => setEditing({ ...editing, email: e.target.value })}
                inputMode="email"
                placeholder="example@example.jp"
                className={input}
              />
            </label>
            <label className={`${label} sm:col-span-2`}>
              住所（施工証明書・記録簿に使います。公開ブログには出ません）
              <input
                value={editing.address ?? ""}
                onChange={(e) => setEditing({ ...editing, address: e.target.value })}
                placeholder="大阪府堺市北区…"
                className={input}
              />
            </label>
            <label className={`${label} sm:col-span-2`}>
              カルテメモ（施工内容・好み・注意点など）
              <textarea
                value={editing.note ?? ""}
                onChange={(e) => setEditing({ ...editing, note: e.target.value })}
                rows={3}
                className={input}
              />
            </label>
          </div>
          {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={save}
              className="rounded-lg bg-gold-500 px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              保存
            </button>
            <button type="button" onClick={() => setEditing(null)} className="text-sm text-ink-soft hover:underline">
              キャンセル
            </button>
            {editing.id && (
              <button
                type="button"
                disabled={busy}
                onClick={() => remove(editing as CustomerRow)}
                className="ml-auto text-sm text-red-600 hover:underline"
              >
                削除
              </button>
            )}
          </div>
        </Card>
      )}

      {/* 一覧（車検が近い順）。行の中にその方の車両を出し、ここから修正・証明書まで行ける */}
      {filtered.length === 0 ? (
        <EmptyState message={q ? "該当するお客様がいません。" : "まだ登録がありません。「＋追加」からお客様を登録しましょう。"} />
      ) : (
        <Card className="divide-y divide-line p-0">
          {filtered.map((c) => {
            const left = daysLeft(c.inspectionExpiry);
            return (
              <div key={c.id} className="p-3">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditing(c)}
                    className="min-w-0 flex-1 text-left"
                    title="カルテ（お客様情報）を編集"
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="whitespace-nowrap text-sm font-semibold text-ink">{c.name} 様</span>
                      {c.vehicleName && <span className="truncate text-xs text-ink-soft">{c.vehicleName}</span>}
                    </div>
                    <div className="mt-0.5 truncate text-xs text-ink-soft">
                      {c.tel && <span className="mr-2">📞 {c.tel}</span>}
                      {c.note && <span>{c.note.slice(0, 30)}{c.note.length > 30 ? "…" : ""}</span>}
                    </div>
                  </button>
                  {left !== null && (
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold ${
                        left <= 30 ? "bg-red-100 text-red-700" : left <= 60 ? "bg-amber-100 text-amber-800" : "bg-surface-2 text-ink-soft"
                      }`}
                    >
                      {left < 0 ? "車検切れ" : `車検あと${left}日`}
                    </span>
                  )}
                </div>

                {/* 登録済み車両（車検証を撮り直さずにここで直せる） */}
                <div className="mt-1.5 space-y-1">
                  {c.vehicles.map((v) => (
                    <div
                      key={v.vehicleId}
                      className="flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg bg-surface-2 px-2 py-1.5"
                    >
                      <span className="text-xs font-semibold text-ink">🚗 {v.vehicleName || v.maker || "車両"}</span>
                      {v.modelCode && <span className="text-[11px] text-ink-soft">型式 {v.modelCode}</span>}
                      {v.chassisLast3 && <span className="text-[11px] text-ink-soft">車台下3桁 {v.chassisLast3}</span>}
                      <span className="ml-auto flex shrink-0 items-center gap-2">
                        <button
                          type="button"
                          onClick={() => {
                            setDone(null);
                            setEditVehicleId(v.vehicleId);
                          }}
                          className="text-[11px] font-semibold text-ink-soft hover:underline"
                        >
                          車両を修正
                        </button>
                        <Link
                          href={`/dealer/pit/certificates/new?vehicleId=${v.vehicleId}`}
                          className="rounded-lg border border-gold-300 px-2 py-1 text-[11px] font-bold text-ink"
                        >
                          証明書
                        </Link>
                      </span>
                    </div>
                  ))}
                  <Link
                    href={`/dealer/pit/vehicles?customerId=${c.id}`}
                    className="inline-block text-[11px] font-semibold text-ink-soft hover:underline"
                  >
                    ＋ この方の車両を追加（車検証の読み取り／手入力）
                  </Link>
                </div>
              </div>
            );
          })}
        </Card>
      )}
      <p className="text-[11px] text-ink-soft">
        車検満了日を入れておくと、ホーム画面に「車検が近いお客様」として60日前からお知らせが出ます。
      </p>
    </div>
  );
}
