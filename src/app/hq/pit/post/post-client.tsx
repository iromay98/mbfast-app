"use client";

import { useState } from "react";
import { Card } from "@/components/ui";
import { PitPostForm } from "@/app/dealer/pit/pit-post-form";

type StoreOption = {
  id: string;
  displayName: string;
  active: boolean;
  dealerId: string | null;
};

// 本部投稿: 店舗セレクタ＋投稿フォーム。既定は本店直営店舗（あれば）。
// key={storeId} でフォームを店舗切替時にリセットする（入力の取り違え防止）。
export function HqPitPostClient({ stores }: { stores: StoreOption[] }) {
  const [storeId, setStoreId] = useState(
    () => (stores.find((s) => s.dealerId === null && s.active) ?? stores[0]).id,
  );

  return (
    <div className="space-y-4">
      <Card>
        <label className="block text-xs font-semibold text-ink-soft">
          投稿する店舗
          <select
            value={storeId}
            onChange={(e) => setStoreId(e.target.value)}
            className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink"
          >
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.displayName}
                {s.dealerId === null ? "（本店直営）" : ""}
                {s.active ? "" : "（停止中）"}
              </option>
            ))}
          </select>
        </label>
      </Card>
      <Card>
        <PitPostForm key={storeId} storeId={storeId} />
      </Card>
    </div>
  );
}
