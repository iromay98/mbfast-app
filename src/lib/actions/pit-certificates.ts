"use server";

/*
 * 施工証明書の作成・発行（加盟店の操作）。
 * 店舗はセッションから解決し、他店の車両・顧客・証明書には一切触れない。
 */
import { revalidatePath } from "next/cache";
import { actingPitStore } from "@/server/pit/acting-store";
import { prisma } from "@/lib/db";
import {
  saveCertificateDraft,
  issueCertificate,
  setShareRevoked,
  voidAndClone,
  type CertificateCoreInput,
  type SaveResult,
} from "@/server/pit/certificate";
import { ensureBlogDraftForCertificate } from "@/server/pit/cert-blog-link";

const LIST = "/dealer/pit/certificates";
const HQ_LIST = "/hq/pit/certificates"; // 本部の代行画面

/** 操作対象の店舗（加盟店は自店固定・本部は storeId で代行） */
async function storeContext(storeId?: string) {
  const own = await actingPitStore(storeId);
  if (!own.store) return { error: own.error };
  return { store: own.store };
}

export async function saveCertificate(
  input: CertificateCoreInput,
  certificateId?: string,
  storeId?: string,
): Promise<SaveResult> {
  const ctx = await storeContext(storeId);
  if (!ctx.store) return { error: ctx.error };
  const r = await saveCertificateDraft(ctx.store, input, certificateId);
  if (r.ok) {
    // 下書き保存の時点で、施工ブログの下書きを投稿一覧にスタンバイさせる（導線）。
    // 失敗しても証明書の保存は成立させる（best-effort・非公開情報は持ち込まない）。
    if (r.certificateId) {
      try {
        await ensureBlogDraftForCertificate(ctx.store.id, r.certificateId);
      } catch (e) {
        console.error("mbPIT: 施工ブログ下書きのスタンバイ作成に失敗（証明書の保存は成功）", e);
      }
    }
    revalidatePath(LIST);
    revalidatePath(HQ_LIST);
    revalidatePath("/dealer/pit/home");
    revalidatePath("/dealer/pit"); // 投稿一覧にスタンバイ下書きを反映
  }
  return r;
}

export async function publishCertificate(
  certificateId: string,
  warrantyUntil = "",
  storeId?: string,
): Promise<{ ok?: true; error?: string; shareUrl?: string }> {
  const ctx = await storeContext(storeId);
  if (!ctx.store) return { error: ctx.error };
  const r = await issueCertificate(ctx.store, certificateId, { warrantyUntil });
  if (r.error) return { error: r.error };
  revalidatePath(LIST);
  revalidatePath(HQ_LIST);
  revalidatePath(`${LIST}/${certificateId}`);
  revalidatePath(`${HQ_LIST}/${certificateId}`);
  revalidatePath("/dealer/pit/home");
  return { ok: true, shareUrl: `/cert/${r.shareToken}` };
}

export async function toggleCertificateShare(
  certificateId: string,
  revoked: boolean,
  storeId?: string,
): Promise<{ ok?: true; error?: string }> {
  const ctx = await storeContext(storeId);
  if (!ctx.store) return { error: ctx.error };
  const r = await setShareRevoked(ctx.store.id, certificateId, revoked);
  if (r.ok) {
    revalidatePath(`${LIST}/${certificateId}`);
    revalidatePath(`${HQ_LIST}/${certificateId}`);
  }
  return r;
}

/** 訂正: 元を無効化し、内容を引き継いだ下書きを作る（発行済みは書き換えない） */
export async function reviseCertificate(
  certificateId: string,
  reason: string,
  storeId?: string,
): Promise<{ ok?: true; error?: string; certificateId?: string }> {
  const ctx = await storeContext(storeId);
  if (!ctx.store) return { error: ctx.error };
  const r = await voidAndClone(ctx.store, certificateId, reason);
  if (r.ok) {
    revalidatePath(LIST);
    revalidatePath(HQ_LIST);
    revalidatePath("/dealer/pit/home");
  }
  return r;
}
