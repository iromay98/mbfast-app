"use server";

/*
 * 施工証明書の作成・発行（加盟店の操作）。
 * 店舗はセッションから解決し、他店の車両・顧客・証明書には一切触れない。
 */
import { revalidatePath } from "next/cache";
import { ownPitStore } from "@/server/pit/own-store";
import { prisma } from "@/lib/db";
import {
  saveCertificateDraft,
  issueCertificate,
  setShareRevoked,
  voidAndClone,
  type CertificateCoreInput,
  type SaveResult,
} from "@/server/pit/certificate";

const LIST = "/dealer/pit/certificates";

async function storeContext() {
  const own = await ownPitStore();
  if (!own.store) return { error: own.error };
  const store = await prisma.pitStore.findUnique({
    where: { id: own.store.id },
    select: { id: true, slug: true, facilityType: true, certificationNo: true },
  });
  if (!store) return { error: "店舗が見つかりません" };
  return { store };
}

export async function saveCertificate(
  input: CertificateCoreInput,
  certificateId?: string,
): Promise<SaveResult> {
  const ctx = await storeContext();
  if (!ctx.store) return { error: ctx.error };
  const r = await saveCertificateDraft(ctx.store, input, certificateId);
  if (r.ok) {
    revalidatePath(LIST);
    revalidatePath("/dealer/pit/home");
  }
  return r;
}

export async function publishCertificate(
  certificateId: string,
  warrantyUntil = "",
): Promise<{ ok?: true; error?: string; shareUrl?: string }> {
  const ctx = await storeContext();
  if (!ctx.store) return { error: ctx.error };
  const r = await issueCertificate(ctx.store, certificateId, { warrantyUntil });
  if (r.error) return { error: r.error };
  revalidatePath(LIST);
  revalidatePath(`${LIST}/${certificateId}`);
  revalidatePath("/dealer/pit/home");
  return { ok: true, shareUrl: `/cert/${r.shareToken}` };
}

export async function toggleCertificateShare(
  certificateId: string,
  revoked: boolean,
): Promise<{ ok?: true; error?: string }> {
  const ctx = await storeContext();
  if (!ctx.store) return { error: ctx.error };
  const r = await setShareRevoked(ctx.store.id, certificateId, revoked);
  if (r.ok) revalidatePath(`${LIST}/${certificateId}`);
  return r;
}

/** 訂正: 元を無効化し、内容を引き継いだ下書きを作る（発行済みは書き換えない） */
export async function reviseCertificate(
  certificateId: string,
  reason: string,
): Promise<{ ok?: true; error?: string; certificateId?: string }> {
  const ctx = await storeContext();
  if (!ctx.store) return { error: ctx.error };
  const r = await voidAndClone(ctx.store, certificateId, reason);
  if (r.ok) {
    revalidatePath(LIST);
    revalidatePath("/dealer/pit/home");
  }
  return r;
}
