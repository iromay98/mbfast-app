"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui";
import { loadVehicleEdit, saveVehicleEdit } from "@/lib/actions/pit-vehicles";

const input = "mt-0.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink";
const label = "block text-[11px] font-semibold text-ink-soft";

type Values = {
  vin: string;
  vehicleName: string;
  maker: string;
  modelCode: string;
  firstRegistered: string;
  inspectionExpiry: string;
  registrationNumber: string;
};

/*
 * 車両情報の修正パネル。車両登録画面と顧客カルテの両方から開く。
 * 「車検証を登録し直さないと直せない」状態を作らないため、UIは1つに保って
 * 置き場所（画面）だけを増やす。車台番号は表示専用（変えると別の車になる）。
 * 読み込みは loadVehicleEdit（復号は監査ログ経由）・保存は saveVehicleEdit のみ。
 */
export function VehicleEditPanel({
  vehicleId,
  storeId,
  onClose,
  onSaved,
}: {
  vehicleId: string;
  /** 本部が代行するときの対象店舗（加盟店では undefined＝自店に固定） */
  storeId?: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const [values, setValues] = useState<Values | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // vehicleId ごとに作り直す（呼び出し側で key を渡す）ので、ここでは読み込みだけを行う
  useEffect(() => {
    let alive = true;
    void (async () => {
      const r = await loadVehicleEdit(vehicleId, storeId);
      if (!alive) return;
      if (r.error || !r.values) setError(r.error ?? "読み込めませんでした");
      else setValues(r.values);
    })();
    return () => {
      alive = false;
    };
  }, [vehicleId, storeId]);

  const save = async () => {
    if (!values) return;
    setBusy(true);
    setError(null);
    try {
      // vin は表示専用（車台番号は変更させない）ので送らない
      const { vehicleName, maker, modelCode, firstRegistered, inspectionExpiry, registrationNumber } = values;
      const r = await saveVehicleEdit(
        vehicleId,
        { vehicleName, maker, modelCode, firstRegistered, inspectionExpiry, registrationNumber },
        storeId,
      );
      if (r.error) setError(r.error);
      else onSaved(r.changed?.length ? "修正しました" : "変更はありませんでした");
    } catch {
      setError("通信エラーが発生しました");
    } finally {
      setBusy(false);
    }
  };

  const set = (patch: Partial<Values>) => setValues((v) => (v ? { ...v, ...patch } : v));

  return (
    <Card className="border-gold-300">
      <h3 className="mb-1 text-sm font-bold text-ink">車両情報を修正</h3>
      {error && <p className="mb-2 rounded-lg bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">{error}</p>}
      {!values ? (
        <p className="text-xs text-ink-soft">{error ? "" : "読み込み中…"}</p>
      ) : (
        <>
          <p className="mb-2 text-[11px] text-ink-soft">
            車台番号 <span className="font-mono font-semibold text-ink">{values.vin || "（読み取れませんでした）"}</span>
            <br />
            車台番号が違っている場合は、この画面では直せません（別の車として扱われるため）。
            正しい車台番号で登録し直し、間違った車両は「解除」してください。
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <label className={label}>
              車種表示
              <input value={values.vehicleName} onChange={(e) => set({ vehicleName: e.target.value })} className={input} />
            </label>
            <label className={label}>
              車名（メーカー）
              <input value={values.maker} onChange={(e) => set({ maker: e.target.value })} className={input} />
            </label>
            <label className={label}>
              型式
              <input value={values.modelCode} onChange={(e) => set({ modelCode: e.target.value })} className={input} />
            </label>
            <label className={label}>
              登録番号（ナンバー）
              <input
                value={values.registrationNumber}
                onChange={(e) => set({ registrationNumber: e.target.value })}
                placeholder="大阪 300 あ 12-34"
                className={input}
              />
            </label>
            <label className={label}>
              初度登録年月
              <input
                type="month"
                value={values.firstRegistered}
                onChange={(e) => set({ firstRegistered: e.target.value })}
                className={input}
              />
            </label>
            <label className={label}>
              車検満了日
              <input
                type="date"
                value={values.inspectionExpiry}
                onChange={(e) => set({ inspectionExpiry: e.target.value })}
                className={input}
              />
            </label>
          </div>
          <p className="mt-2 text-[11px] text-ink-soft">
            空欄にして保存するとその項目は消えます。修正の記録（誰がいつ何を直したか）は残ります。
          </p>
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={save}
              className="rounded-lg bg-gold-500 px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
            >
              {busy ? "保存中…" : "修正を保存"}
            </button>
            <button type="button" onClick={onClose} className="text-sm text-ink-soft hover:underline">
              キャンセル
            </button>
          </div>
        </>
      )}
      {!values && error && (
        <button type="button" onClick={onClose} className="mt-1 text-sm text-ink-soft hover:underline">
          閉じる
        </button>
      )}
    </Card>
  );
}
