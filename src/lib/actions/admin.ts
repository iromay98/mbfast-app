"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireHQ } from "@/lib/authz";
import { storage } from "@/server/storage";
import { extractEcuId } from "@/server/ecu/identify";

// 1件分の変更内容（before→after）。値が増える項目のみ載る。
export type EcuChange = {
  id: string;
  label: string;
  cal?: { before: string | null; after: string };
  sw?: { before: string | null; after: string };
  hw?: { before: string | null; after: string };
};

export type ReextractResult = {
  scanned: number; // 復号binを持つ記録数
  skipped: number; // binが読めなかった数
  changed: number; // 変化のある記録数
  items: EcuChange[];
  applied: boolean; // true=DB更新済み / false=プレビュー
};

// 保存済みの復号binから HW/SW/Cal を抽出し直す。再アップロード・再復号は不要（AutoTuner API不使用）。
// apply=false ならプレビュー（DBは触らない）、true なら更新。
// 既存値が非nullでも、新たに抽出できた値と異なれば上書きする（取りこぼし→取得 を反映）。
// 新たな抽出が null の項目は既存値を消さない（regression時の安全策）。
async function runReextract(apply: boolean): Promise<ReextractResult> {
  await requireHQ();
  const records = await prisma.serviceRecord.findMany({
    where: { decryptedFilePath: { not: null }, deletedAt: null },
    orderBy: { workedAt: "desc" },
    select: {
      id: true,
      carMaker: true,
      carModel: true,
      slaveName: true,
      decryptedFilePath: true,
      hwNumber: true,
      swNumber: true,
      calNumber: true,
    },
  });

  let skipped = 0;
  let changed = 0;
  const items: EcuChange[] = [];

  for (const r of records) {
    const file = r.decryptedFilePath ? await storage.read(r.decryptedFilePath) : null;
    if (!file) {
      skipped++;
      continue;
    }
    const ecu = extractEcuId(file.buffer);
    const change: EcuChange = {
      id: r.id,
      label: `${r.carMaker ?? ""} ${r.carModel ?? ""}`.trim() || r.slaveName || r.id,
    };
    const data: Prisma.ServiceRecordUpdateInput = {};
    let any = false;
    if (ecu.cal && ecu.cal !== r.calNumber) {
      change.cal = { before: r.calNumber, after: ecu.cal };
      data.calNumber = ecu.cal;
      any = true;
    }
    if (ecu.sw && ecu.sw !== r.swNumber) {
      change.sw = { before: r.swNumber, after: ecu.sw };
      data.swNumber = ecu.sw;
      any = true;
    }
    if (ecu.hw && ecu.hw !== r.hwNumber) {
      change.hw = { before: r.hwNumber, after: ecu.hw };
      data.hwNumber = ecu.hw;
      any = true;
    }
    if (!any) continue;

    changed++;
    items.push(change);
    if (apply) {
      data.ecuIdRaw = ecu as unknown as Prisma.InputJsonValue;
      await prisma.serviceRecord.update({ where: { id: r.id }, data });
      revalidatePath(`/hq/records/${r.id}`);
    }
  }

  if (apply) revalidatePath("/hq/records");
  return { scanned: records.length, skipped, changed, items, applied: apply };
}

export async function previewReextractEcu(): Promise<ReextractResult> {
  return runReextract(false);
}

export async function applyReextractEcu(): Promise<ReextractResult> {
  return runReextract(true);
}
