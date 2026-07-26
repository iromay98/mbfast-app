"use server";

import { revalidatePath } from "next/cache";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireHQ } from "@/lib/authz";
import { storage } from "@/server/storage";
import { smartExtractEcuId } from "@/server/ecu/learn";

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
      decryptedHash: true,
      ecuType: true,
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
    const ecu = await smartExtractEcuId(file.buffer, {
      hash: r.decryptedHash,
      ecuType: r.ecuType,
    });
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

// 学習ルール（EcuRule）を削除（誤学習の整理用）。
export async function deleteEcuRule(id: string): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  await prisma.ecuRule.delete({ where: { id } });
  revalidatePath("/hq/admin");
  return { ok: true };
}

// 通知経路の疎通テスト。各チャネルへ直接送信し、結果（特にWeb Pushの成功/失敗内訳）を返す。
// 例: 購読7件で 403 が並ぶ → 購読時と現在のVAPIDキーが不一致（購読の作り直しが必要）。
export type TestNotifyResult = {
  ok: true;
  push: { enabled: boolean; subs: number; sent: number; failedByStatus: Record<string, number> };
  email: { enabled: boolean; error?: string };
  line: { enabled: boolean; error?: string };
};

export async function sendTestNotification(): Promise<TestNotifyResult> {
  await requireHQ();
  const { pushEnabled, sendPushToUsers, recipientUserIds } = await import("@/server/push");
  const { emailNotifyEnabled, sendNotificationEmail } = await import("@/server/notifications/email");
  const { lineNotifyEnabled, sendNotificationLine } = await import("@/server/notifications/line");

  const payload = {
    type: "TEST" as const,
    title: "テスト通知",
    message: `通知経路の疎通テストです（${new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", dateStyle: "short", timeStyle: "medium" }).format(new Date())}）`,
    dealerId: null,
    link: "/hq/admin",
  };

  // Web Push（本店管理者宛て）: 結果の内訳を取得
  let pushRes = { subs: 0, ok: 0, failedByStatus: {} as Record<string, number> };
  if (pushEnabled()) {
    const recipients = await recipientUserIds({ toHQ: true });
    pushRes = await sendPushToUsers(recipients, {
      title: payload.title,
      body: payload.message,
      url: payload.link,
      tag: "test",
    });
  }

  let emailError: string | undefined;
  try {
    await sendNotificationEmail(payload);
  } catch (e) {
    emailError = e instanceof Error ? e.message : String(e);
  }
  let lineError: string | undefined;
  try {
    await sendNotificationLine(payload);
  } catch (e) {
    lineError = e instanceof Error ? e.message : String(e);
  }

  return {
    ok: true,
    push: {
      enabled: pushEnabled(),
      subs: pushRes.subs,
      sent: pushRes.ok,
      failedByStatus: pushRes.failedByStatus,
    },
    email: { enabled: emailNotifyEnabled(), ...(emailError ? { error: emailError } : {}) },
    line: { enabled: lineNotifyEnabled(), ...(lineError ? { error: lineError } : {}) },
  };
}
