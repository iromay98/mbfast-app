"use client";

// オプションを触った後の「遅延反映」。
// 連続でタップしても、最後の操作から一定時間おいてから車両ごとに1回だけWPへ反映する。
// （1タップごとに反映すると1回2〜3秒の書き込みが積み上がるため）

import { syncVehicleByVehicleId } from "@/lib/actions/vehicle-pages";

const DELAY_MS = 10_000;

type Listener = (state: { pending: boolean; warning: string | null }) => void;

const timers = new Map<string, ReturnType<typeof setTimeout>>();
const listeners = new Map<string, Set<Listener>>();
const inFlight = new Set<string>();

function emit(vehicleId: string, state: { pending: boolean; warning: string | null }) {
  listeners.get(vehicleId)?.forEach((fn) => fn(state));
}

export function subscribeSync(vehicleId: string, fn: Listener): () => void {
  const set = listeners.get(vehicleId) ?? new Set<Listener>();
  set.add(fn);
  listeners.set(vehicleId, set);
  return () => {
    set.delete(fn);
    if (set.size === 0) listeners.delete(vehicleId);
  };
}

/** 反映を予約する。同じ車両で続けて呼ばれたらタイマーを引き直す */
export function scheduleSync(vehicleId: string): void {
  const existing = timers.get(vehicleId);
  if (existing) clearTimeout(existing);
  emit(vehicleId, { pending: true, warning: null });
  const t = setTimeout(async () => {
    timers.delete(vehicleId);
    if (inFlight.has(vehicleId)) {
      // 実行中に再度予約が入っていた場合は、終わってからもう一度
      scheduleSync(vehicleId);
      return;
    }
    inFlight.add(vehicleId);
    try {
      const r = await syncVehicleByVehicleId(vehicleId);
      emit(vehicleId, { pending: false, warning: r.warning ?? null });
    } catch {
      emit(vehicleId, { pending: false, warning: "WP反映に失敗しました" });
    } finally {
      inFlight.delete(vehicleId);
    }
  }, DELAY_MS);
  timers.set(vehicleId, t);
}

/** ページを離れる前に、予約済みの反映をすぐ実行する */
export function flushPendingSyncs(): void {
  for (const [vehicleId, t] of timers) {
    clearTimeout(t);
    timers.delete(vehicleId);
    void syncVehicleByVehicleId(vehicleId);
  }
}

export function hasPendingSyncs(): boolean {
  return timers.size > 0 || inFlight.size > 0;
}
