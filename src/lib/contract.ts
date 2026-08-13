/*
 * 代理店契約（1年更新）の期日計算。**次回更新日の計算はここだけ**。
 *
 * DBには契約開始日だけを持ち、更新日は毎回ここで計算する（更新のたびに日付を
 * 書き換える運用にしない＝更新漏れでズレる事故を作らない）。
 *
 * 期日の決め方:
 * - 更新日 = 開始日の応当日。周期は contractRenewalMonths（既定12ヶ月＝1年更新）
 * - 「今日以降で最初に来る応当日」を次回更新日とする（当日は"今日が更新日"として扱う）
 * - 応当日が存在しない日付（1/31 の1ヶ月後など）は**その月の末日**に丸める
 *   （2/31 のような無効日付をJSのDateが3/3へ繰り上げるのを防ぐ）
 * - 見直し時期 = 次回更新日の contractNoticeDays 日前から。条件変更の申し出に
 *   猶予が必要なため、更新日当日ではなく手前で気付けるようにする
 *
 * 日付は「日単位」で扱う（時刻は無視）。JSTで運用するため、比較は UTC の年月日ではなく
 * JSTの年月日に正規化してから行う。
 */

/** JSTの「その日の0時」に丸めた日付を返す（時刻成分を落として日数計算を安定させる） */
function startOfDayJst(d: Date): Date {
  // sv-SE ロケールは "YYYY-MM-DD" 形式
  const ymd = d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  const [y, m, day] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, day));
}

/** 月を足した日付（応当日が無い月は末日に丸める） */
function addMonthsClamped(base: Date, months: number): Date {
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth();
  const d = base.getUTCDate();
  const targetMonthLast = new Date(Date.UTC(y, m + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m + months, Math.min(d, targetMonthLast)));
}

export const DAY_MS = 24 * 60 * 60 * 1000;

export type ContractInput = {
  contractStartedAt: Date | null;
  contractRenewalMonths: number;
  contractNoticeDays: number;
  contractEndedAt: Date | null;
};

export type ContractStatus = {
  /** 開始日が未登録なら null（それ以外は必ず値が入る） */
  startedAt: Date | null;
  /** 解約済みならその日付 */
  endedAt: Date | null;
  /** 次回更新日（解約済み・未登録なら null） */
  nextRenewalAt: Date | null;
  /** 次回更新日までの日数（0=今日が更新日。解約済み・未登録なら null） */
  daysUntilRenewal: number | null;
  /** 契約年数（次回更新で何年目に入るか。1年更新の場合の「◯年目」表示に使う） */
  termNumber: number | null;
  /** 見直し時期に入っているか（更新日の contractNoticeDays 日前〜更新日） */
  noticeDue: boolean;
  /** 更新日を過ぎている（＝自動更新済みだが記録上の確認が要る場合の目印） */
  overdue: boolean;
};

export function contractStatus(d: ContractInput, now: Date = new Date()): ContractStatus {
  const today = startOfDayJst(now);
  if (!d.contractStartedAt) {
    return {
      startedAt: null, endedAt: d.contractEndedAt, nextRenewalAt: null,
      daysUntilRenewal: null, termNumber: null, noticeDue: false, overdue: false,
    };
  }
  const start = startOfDayJst(d.contractStartedAt);
  if (d.contractEndedAt) {
    return {
      startedAt: start, endedAt: d.contractEndedAt, nextRenewalAt: null,
      daysUntilRenewal: null, termNumber: null, noticeDue: false, overdue: false,
    };
  }

  const cycle = d.contractRenewalMonths > 0 ? d.contractRenewalMonths : 12;
  // 今日以降で最初に来る応当日を探す（開始日が未来なら開始日そのもの）
  let n = 0;
  let next = start;
  while (next.getTime() < today.getTime()) {
    n += 1;
    next = addMonthsClamped(start, cycle * n);
    if (n > 200) break; // 安全弁（開始日が極端に古い場合）
  }
  const daysUntil = Math.round((next.getTime() - today.getTime()) / DAY_MS);
  const notice = d.contractNoticeDays >= 0 ? d.contractNoticeDays : 60;

  return {
    startedAt: start,
    endedAt: null,
    nextRenewalAt: next,
    daysUntilRenewal: daysUntil,
    // 次の更新を迎えると n+1 期目に入る（開始直後は1期目＝n=0 なので +1）
    termNumber: n + 1,
    noticeDue: daysUntil <= notice,
    overdue: false,
  };
}

/** "2026-08-12" 形式（input[type=date] の値・表示の共通形） */
export function toDateInputValue(d: Date | null): string {
  if (!d) return "";
  return d.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
}

/** 表示用: 2026年8月12日 */
export function formatContractDate(d: Date | null): string {
  if (!d) return "—";
  const ymd = toDateInputValue(d);
  const [y, m, day] = ymd.split("-").map(Number);
  return `${y}年${m}月${day}日`;
}

/** 残り日数の日本語表現（一覧のバッジ用） */
export function renewalLabel(s: ContractStatus): string {
  if (!s.startedAt) return "契約日未登録";
  if (s.endedAt) return `解約済み（${formatContractDate(s.endedAt)}）`;
  if (s.daysUntilRenewal === null || !s.nextRenewalAt) return "—";
  if (s.daysUntilRenewal === 0) return "今日が更新日";
  if (s.daysUntilRenewal < 0) return `更新日を過ぎています（${-s.daysUntilRenewal}日）`;
  return `あと${s.daysUntilRenewal}日（${formatContractDate(s.nextRenewalAt)}）`;
}
