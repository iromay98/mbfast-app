"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { getSessionUser, requireHQ } from "@/lib/authz";
import { storage } from "@/server/storage";
import { decryptSlave } from "@/server/autotuner/client";
import { createHash } from "node:crypto";

// 左右ECU（1台に2基のECUがある車）: 2基目のスレーブを同じ記録にぶら下げる。
// キャリブレーション(.slave配布)は左右共通のため既存の仕組みのまま。bak系だけ側別になる。

function reval(recordId: string): void {
  revalidatePath(`/hq/records/${recordId}`);
  revalidatePath(`/dealer/records/${recordId}`);
}

async function authz(recordId: string): Promise<{ ok: boolean; error?: string }> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "ログインしてください" };
  if (user.role === "HQ_ADMIN") return { ok: true };
  const rec = await prisma.serviceRecord.findUnique({ where: { id: recordId }, select: { dealerId: true } });
  if (!rec || rec.dealerId !== user.dealerId) return { ok: false, error: "権限がありません" };
  return { ok: true };
}

// ── 2基目のスレーブをアップして追加（本店 or 施工代理店） ──
export async function addEcuSide(
  recordId: string,
  formData: FormData,
): Promise<{ ok?: true; error?: string }> {
  const az = await authz(recordId);
  if (!az.ok) return { error: az.error };

  const rec = await prisma.serviceRecord.findUnique({
    where: { id: recordId },
    select: { id: true, primarySide: true },
  });
  if (!rec) return { error: "記録が見つかりません" };

  const side = String(formData.get("side") ?? "").trim();
  if (!side) return { error: "側（左/右）を選んでください" };
  if (side === rec.primarySide) return { error: `「${side}」は既にこの記録のメイン側です` };

  const file = formData.get("slaveFile");
  if (!(file instanceof File) || file.size === 0) return { error: "スレーブファイルを選んでください" };

  const buf = Buffer.from(await file.arrayBuffer());
  // decrypt(maps) して encrypt用IDと backup対応を取得（車両不一致もここで発覚する）
  let meta;
  try {
    const dec = await decryptSlave(buf, { recordId, mode: "maps" });
    meta = dec.meta;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { error: `スレーブの復号に失敗しました: ${msg}` };
  }

  const hash = createHash("sha256").update(buf).digest("hex");
  const key = `records/sides/${recordId}/${Date.now()}-${side}.slave`;
  await storage.save(key, buf, "application/octet-stream");

  try {
    await prisma.recordEcuSide.create({
      data: {
        recordId,
        side,
        slaveFilePath: key,
        slaveHash: hash,
        ecuType: meta.ecu ?? null,
        backupSupported: meta.backup_supported ?? null,
        autotunerSlaveId: meta.slave_id ?? null,
        autotunerEcuId: meta.ecu_id ?? null,
        autotunerModelId: meta.model_id ?? null,
        autotunerMcuId: meta.mcu_id ?? null,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("Unique constraint")) return { error: `「${side}」は既に登録されています` };
    return { error: "保存に失敗しました" };
  }
  reval(recordId);
  return { ok: true };
}

// ── 既存の別記録を2基目として統合（本店のみ。過去に左右で別記録になっているペア用） ──
export async function addEcuSideFromRecord(
  recordId: string,
  otherRecordId: string,
  side: string,
): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  if (recordId === otherRecordId) return { error: "同じ記録は統合できません" };

  const [rec, other] = await Promise.all([
    prisma.serviceRecord.findUnique({ where: { id: recordId }, select: { id: true, primarySide: true } }),
    prisma.serviceRecord.findUnique({
      where: { id: otherRecordId },
      select: {
        slaveFilePath: true,
        slaveHash: true,
        ecuType: true,
        backupSupported: true,
        autotunerSlaveId: true,
        autotunerEcuId: true,
        autotunerModelId: true,
        autotunerMcuId: true,
      },
    }),
  ]);
  if (!rec || !other) return { error: "記録が見つかりません" };
  const s = side.trim();
  if (!s) return { error: "側（左/右）を選んでください" };
  if (s === rec.primarySide) return { error: `「${s}」は既にこの記録のメイン側です` };
  if (!other.slaveFilePath) return { error: "統合元の記録にスレーブがありません" };

  // スレーブ実体をコピーして独立させる（元記録を後で削除しても壊れないように）
  const src = await storage.read(other.slaveFilePath);
  if (!src) return { error: "統合元のスレーブファイルが読めません" };
  const key = `records/sides/${recordId}/${Date.now()}-${s}.slave`;
  await storage.save(key, src.buffer, "application/octet-stream");

  try {
    await prisma.recordEcuSide.create({
      data: {
        recordId,
        side: s,
        slaveFilePath: key,
        slaveHash: other.slaveHash,
        ecuType: other.ecuType,
        backupSupported: other.backupSupported,
        autotunerSlaveId: other.autotunerSlaveId,
        autotunerEcuId: other.autotunerEcuId,
        autotunerModelId: other.autotunerModelId,
        autotunerMcuId: other.autotunerMcuId,
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "";
    if (msg.includes("Unique constraint")) return { error: `「${s}」は既に登録されています` };
    return { error: "統合に失敗しました" };
  }
  reval(recordId);
  return { ok: true };
}

// ── 2基目の削除（本店のみ） ──
export async function removeEcuSide(sideId: string): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  const side = await prisma.recordEcuSide.findUnique({
    where: { id: sideId },
    select: { id: true, recordId: true, slaveFilePath: true },
  });
  if (!side) return { error: "見つかりません" };
  await prisma.recordEcuSide.delete({ where: { id: sideId } });
  await storage.delete(side.slaveFilePath).catch(() => {});
  reval(side.recordId);
  return { ok: true };
}

// ── メイン側のラベル変更（本店のみ。左⇄右） ──
export async function setPrimarySide(recordId: string, label: string): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  const v = label.trim();
  if (!v) return { error: "ラベルを入力してください" };
  const dup = await prisma.recordEcuSide.findFirst({ where: { recordId, side: v }, select: { id: true } });
  if (dup) return { error: `「${v}」は2基目側で使われています` };
  await prisma.serviceRecord.update({ where: { id: recordId }, data: { primarySide: v } });
  reval(recordId);
  return { ok: true };
}
