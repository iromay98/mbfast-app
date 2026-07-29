"use client";

import { useRouter, useSearchParams } from "next/navigation";

/*
 * 本部が「どの店舗として操作するか」を選ぶ。
 * 投稿の代行（/hq/pit/post）と同じ考え方で、車両登録・証明書も店舗を選んで代行する。
 * 選択は URL の storeId に持たせる（リロード・共有しても状態が残る）。
 */
export function StorePicker({
  stores,
  storeId,
  path,
}: {
  stores: { id: string; label: string }[];
  storeId: string;
  /** 遷移先のパス（例: /hq/pit/vehicles） */
  path: string;
}) {
  const router = useRouter();
  const params = useSearchParams();

  return (
    <label className="block text-[11px] font-semibold text-ink-soft">
      操作する店舗（本部の代行入力）
      <select
        value={storeId}
        onChange={(e) => {
          const next = new URLSearchParams(params.toString());
          if (e.target.value) next.set("storeId", e.target.value);
          else next.delete("storeId");
          router.push(`${path}?${next.toString()}`);
        }}
        className="mt-0.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm font-semibold text-ink"
      >
        <option value="">選択してください</option>
        {stores.map((s) => (
          <option key={s.id} value={s.id}>
            {s.label}
          </option>
        ))}
      </select>
    </label>
  );
}
