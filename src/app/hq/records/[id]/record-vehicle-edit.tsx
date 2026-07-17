"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setRecordVehicle } from "@/lib/actions/records";

// 記録の車両（メーカー・車種）を本店がその場で修正。
// 照合済みならカタログ(BaseFile)にも同じ値を反映する（表示元がカタログのため）。
export function RecordVehicleEdit({
  recordId,
  carMaker,
  carModel,
  makerOptions,
  matched,
}: {
  recordId: string;
  carMaker: string;
  carModel: string;
  makerOptions: string[];
  matched: boolean;
}) {
  const [maker, setMaker] = useState(carMaker);
  const [model, setModel] = useState(carModel);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const save = (patch: { carMaker?: string; carModel?: string }) =>
    start(async () => {
      setSaved(false);
      setError(null);
      const r = await setRecordVehicle(recordId, patch);
      if (r.error) setError(r.error);
      else setSaved(true);
      router.refresh();
    });

  const inp =
    "min-w-0 rounded border border-line bg-surface px-2 py-1 text-xs focus:border-gold-400 focus:outline-none";

  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      <span className="font-semibold text-ink-soft">車両</span>
      <input
        value={maker}
        list={`rec-makers-${recordId}`}
        placeholder="メーカー"
        onChange={(e) => setMaker(e.target.value)}
        onBlur={() => {
          if (maker.trim() !== carMaker) save({ carMaker: maker.trim() });
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className={`${inp} w-24`}
      />
      <datalist id={`rec-makers-${recordId}`}>
        {makerOptions.map((m) => (
          <option key={m} value={m} />
        ))}
      </datalist>
      <input
        value={model}
        placeholder="車種"
        onChange={(e) => setModel(e.target.value)}
        onBlur={() => {
          if (model.trim() !== carModel) save({ carModel: model.trim() });
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
        }}
        className={`${inp} w-28`}
      />
      {pending && <span className="text-ink-soft">保存中…</span>}
      {saved && !pending && (
        <span className="font-semibold text-green-700">
          保存しました{matched ? "（カタログにも反映）" : ""}
        </span>
      )}
      {error && <span className="text-red-600">{error}</span>}
      {matched && !saved && (
        <span className="text-[10px] text-ink-soft">
          ※ 照合済み: 変更するとカタログの車両も更新されます
        </span>
      )}
    </div>
  );
}
