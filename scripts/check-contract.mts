/*
 * 契約更新日の計算（src/lib/contract.ts）の検証。DB不要・オフラインで動く。
 *
 * ここで見るのは「1年更新の応当日」の落とし穴:
 *   - 月末（1/31・2/29）の応当日が翌月へ繰り上がらないこと
 *   - うるう年の2/29開始が平年に2/28へ丸まること
 *   - 更新日当日・前日・翌日の境界
 *   - 見直し通知（noticeDays）の境界
 *   - 解約済み・未登録は催促しないこと
 */
import { contractStatus, formatContractDate, toDateInputValue } from "../src/lib/contract";

const d = (s: string) => new Date(`${s}T00:00:00Z`);
let fail = 0;
let n = 0;

function eq(label: string, actual: unknown, expected: unknown) {
  n++;
  const ok = actual === expected;
  if (!ok) fail++;
  console.log(`  ${ok ? "✓" : "✗"} ${label}${ok ? "" : `  期待=${String(expected)} 実際=${String(actual)}`}`);
}

const base = { contractRenewalMonths: 12, contractNoticeDays: 60, contractEndedAt: null };

console.log("[1] 1年更新の応当日");
{
  const s = contractStatus({ ...base, contractStartedAt: d("2025-04-01") }, d("2026-08-12"));
  eq("2025-04-01開始 → 次回2027-04-01", toDateInputValue(s.nextRenewalAt), "2027-04-01");
  eq("期数=3期目", s.termNumber, 3);
}
{
  const s = contractStatus({ ...base, contractStartedAt: d("2026-09-01") }, d("2026-08-12"));
  eq("開始日が未来 → 次回=開始日", toDateInputValue(s.nextRenewalAt), "2026-09-01");
  eq("期数=1期目", s.termNumber, 1);
}

console.log("[2] 更新日ちょうど・前後の境界");
{
  const s = contractStatus({ ...base, contractStartedAt: d("2025-08-12") }, d("2026-08-12"));
  eq("応当日当日は「今日が更新日」", s.daysUntilRenewal, 0);
  eq("その日はまだ2期目に入る扱い", s.termNumber, 2);
}
{
  const s = contractStatus({ ...base, contractStartedAt: d("2025-08-12") }, d("2026-08-13"));
  eq("応当日翌日 → 次は2027-08-12", toDateInputValue(s.nextRenewalAt), "2027-08-12");
  eq("残り364日", s.daysUntilRenewal, 364);
}

console.log("[3] 月末・うるう年の丸め");
{
  const s = contractStatus({ ...base, contractStartedAt: d("2024-02-29") }, d("2026-08-12"));
  eq("2/29開始 → 平年は2/28に丸める", toDateInputValue(s.nextRenewalAt), "2027-02-28");
}
{
  // 半年更新で1/31開始 → 7/31、翌1/31…（2/31のような無効日付を作らない）
  const s = contractStatus(
    { ...base, contractRenewalMonths: 6, contractStartedAt: d("2026-01-31") },
    d("2026-08-12"),
  );
  eq("6ヶ月更新1/31開始 → 2027-01-31", toDateInputValue(s.nextRenewalAt), "2027-01-31");
}
{
  // 3ヶ月更新で8/31開始 → 11/30（30日しかない月へ丸める）
  const s = contractStatus(
    { ...base, contractRenewalMonths: 3, contractStartedAt: d("2026-08-31") },
    d("2026-09-01"),
  );
  eq("3ヶ月更新8/31開始 → 2026-11-30", toDateInputValue(s.nextRenewalAt), "2026-11-30");
}

console.log("[4] 見直し通知の境界（noticeDays=60）");
{
  const s = contractStatus({ ...base, contractStartedAt: d("2025-10-11") }, d("2026-08-12"));
  eq("残り60日 → 見直し時期に入る", s.daysUntilRenewal, 60);
  eq("noticeDue=true", s.noticeDue, true);
}
{
  const s = contractStatus({ ...base, contractStartedAt: d("2025-10-12") }, d("2026-08-12"));
  eq("残り61日 → まだ出さない", s.daysUntilRenewal, 61);
  eq("noticeDue=false", s.noticeDue, false);
}
{
  const s = contractStatus(
    { ...base, contractNoticeDays: 0, contractStartedAt: d("2025-10-11") },
    d("2026-08-12"),
  );
  eq("noticeDays=0 なら当日まで出さない", s.noticeDue, false);
}

console.log("[5] 解約済み・未登録は催促しない");
{
  const s = contractStatus(
    { ...base, contractStartedAt: d("2025-08-12"), contractEndedAt: d("2026-07-31") },
    d("2026-08-12"),
  );
  eq("解約済み → 次回更新なし", s.nextRenewalAt, null);
  eq("解約済み → noticeDue=false", s.noticeDue, false);
}
{
  const s = contractStatus({ ...base, contractStartedAt: null }, d("2026-08-12"));
  eq("未登録 → 次回更新なし", s.nextRenewalAt, null);
  eq("未登録 → noticeDue=false", s.noticeDue, false);
}

console.log("[6] 表示形式");
eq("和文日付", formatContractDate(d("2026-08-12")), "2026年8月12日");
eq("未設定は —", formatContractDate(null), "—");

console.log("");
console.log(fail === 0 ? `✅ ${n}件すべて通過` : `❌ ${fail}/${n}件 失敗`);
process.exit(fail === 0 ? 0 : 1);
