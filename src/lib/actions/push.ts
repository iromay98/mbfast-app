"use server";

import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/authz";

type SubInput = { endpoint: string; p256dh: string; auth: string };

// 現在のユーザーの Web Push 購読を保存（同一 endpoint は upsert）。
export async function savePushSubscription(sub: SubInput): Promise<{ ok?: true; error?: string }> {
  const user = await getSessionUser();
  if (!user) return { error: "ログインが必要です" };
  if (!sub?.endpoint || !sub?.p256dh || !sub?.auth) return { error: "購読情報が不正です" };
  await prisma.pushSubscription.upsert({
    where: { endpoint: sub.endpoint },
    create: { endpoint: sub.endpoint, p256dh: sub.p256dh, auth: sub.auth, userId: user.id },
    update: { p256dh: sub.p256dh, auth: sub.auth, userId: user.id },
  });
  return { ok: true };
}

// 購読解除（endpoint 指定）。
export async function deletePushSubscription(endpoint: string): Promise<{ ok?: true }> {
  const user = await getSessionUser();
  if (!user || !endpoint) return { ok: true };
  await prisma.pushSubscription.deleteMany({ where: { endpoint, userId: user.id } }).catch(() => {});
  return { ok: true };
}
