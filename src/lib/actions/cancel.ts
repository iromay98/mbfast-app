"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireDealer, requireHQ } from "@/lib/authz";
import { notify } from "@/server/notifications";

const PATHS = ["/hq/activity", "/dealer/activity", "/hq/records", "/dealer/records"];
function revalidateAll() {
  for (const p of PATHS) revalidatePath(p);
}

// ── 代理店: 誤DLのキャンセル依頼 ──
export async function requestDownloadCancel(
  logId: string,
  reason: string,
): Promise<{ ok?: true; error?: string }> {
  const user = await requireDealer();
  const log = await prisma.catalogDownloadLog.findUnique({
    where: { id: logId },
    select: { dealerId: true, cancelledAt: true, cancelRequestedAt: true, dealer: { select: { name: true } } },
  });
  if (!log || log.dealerId !== user.dealerId) return { error: "対象が見つかりません" };
  if (log.cancelledAt) return { error: "既にキャンセル済みです" };
  if (log.cancelRequestedAt && !log.cancelledAt) {
    // 却下後の再依頼は許可（rejectedAtをクリアして再申請）
  }
  await prisma.catalogDownloadLog.update({
    where: { id: logId },
    data: {
      cancelRequestedAt: new Date(),
      cancelReason: reason.trim() || null,
      cancelRejectedAt: null,
    },
  });
  await notify({
    type: "CANCEL_REQUESTED",
    title: "ダウンロードのキャンセル依頼",
    message: `${log.dealer?.name ?? "代理店"}：誤DLのキャンセル依頼${reason.trim() ? `（${reason.trim()}）` : ""}`,
    dealerId: null, // 本店宛て
    link: "/hq/activity",
  });
  revalidateAll();
  return { ok: true };
}

// ── 代理店: 誤リクエストのキャンセル依頼 ──
export async function requestFileRequestCancel(
  requestId: string,
  reason: string,
): Promise<{ ok?: true; error?: string }> {
  const user = await requireDealer();
  const req = await prisma.fileRequest.findUnique({
    where: { id: requestId },
    select: { dealerId: true, status: true, dealer: { select: { name: true } } },
  });
  if (!req || req.dealerId !== user.dealerId) return { error: "対象が見つかりません" };
  if (req.status === "DELIVERED") return { error: "納品済みのため取消できません（本店へ相談してください）" };
  if (req.status === "CANCELLED") return { error: "既にキャンセル済みです" };
  await prisma.fileRequest.update({
    where: { id: requestId },
    data: {
      cancelRequestedAt: new Date(),
      cancelReason: reason.trim() || null,
      cancelRejectedAt: null,
    },
  });
  await notify({
    type: "CANCEL_REQUESTED",
    title: "リクエストのキャンセル依頼",
    message: `${req.dealer?.name ?? "代理店"}：誤リクエストのキャンセル依頼${reason.trim() ? `（${reason.trim()}）` : ""}`,
    dealerId: null,
    link: "/hq/activity",
  });
  revalidateAll();
  return { ok: true };
}

// ── 本店: DLキャンセルの承諾/却下 ──
export async function resolveDownloadCancel(
  logId: string,
  approve: boolean,
): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  const log = await prisma.catalogDownloadLog.findUnique({
    where: { id: logId },
    select: { dealerId: true, cancelRequestedAt: true },
  });
  if (!log?.cancelRequestedAt) return { error: "キャンセル依頼がありません" };
  await prisma.catalogDownloadLog.update({
    where: { id: logId },
    data: approve
      ? { cancelledAt: new Date(), cancelRejectedAt: null }
      : { cancelRejectedAt: new Date() },
  });
  await notify({
    type: "CANCEL_RESOLVED",
    title: approve ? "DLキャンセルを承諾しました" : "DLキャンセルは却下されました",
    message: approve
      ? "誤ダウンロードのキャンセルを承諾しました（課金対象から除外）。"
      : "誤ダウンロードのキャンセル依頼は却下されました。",
    dealerId: log.dealerId,
    link: "/dealer/activity",
  });
  revalidateAll();
  return { ok: true };
}

// ── 本店: リクエストキャンセルの承諾/却下 ──
export async function resolveRequestCancel(
  requestId: string,
  approve: boolean,
): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  const req = await prisma.fileRequest.findUnique({
    where: { id: requestId },
    select: { dealerId: true, cancelRequestedAt: true },
  });
  if (!req?.cancelRequestedAt) return { error: "キャンセル依頼がありません" };
  await prisma.fileRequest.update({
    where: { id: requestId },
    data: approve
      ? { status: "CANCELLED", cancelRejectedAt: null }
      : { cancelRejectedAt: new Date() },
  });
  await notify({
    type: "CANCEL_RESOLVED",
    title: approve ? "リクエストのキャンセルを承諾しました" : "リクエストのキャンセルは却下されました",
    message: approve
      ? "リクエストをキャンセルしました。"
      : "リクエストのキャンセル依頼は却下されました（作業を継続します）。",
    dealerId: req.dealerId,
    link: "/dealer/activity",
  });
  revalidateAll();
  return { ok: true };
}
