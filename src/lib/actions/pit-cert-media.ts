"use server";

import { revalidatePath } from "next/cache";
import { actingPitStore } from "@/server/pit/acting-store";
import {
  addCertificateMedia,
  deleteCertificateMedia,
  setCertificateMediaPublic,
} from "@/server/pit/cert-media";

/*
 * 証跡写真の操作。店舗の解決は acting-store が唯一の入口
 * （加盟店は引数の storeId を無視して自店固定・本部だけが任意店舗を指定できる）。
 */
export async function uploadCertMedia(
  certificateId: string,
  formData: FormData,
  storeId?: string,
): Promise<{ ok?: true; error?: string }> {
  const own = await actingPitStore(storeId);
  if (!own.store) return { error: own.error };

  const file = formData.get("file");
  if (!(file instanceof File)) return { error: "ファイルを選択してください" };
  const kind = String(formData.get("kind") ?? "").trim();
  const wantPublic = formData.get("wantPublic") === "1";

  const r = await addCertificateMedia({
    certificateId,
    storeId: own.store.id,
    kind,
    file,
    wantPublic,
  });
  if (r.ok) revalidate(certificateId, storeId);
  return r.ok ? { ok: true } : { error: r.error };
}

export async function toggleCertMediaPublic(
  mediaId: string,
  certificateId: string,
  wantPublic: boolean,
  storeId?: string,
): Promise<{ ok?: true; error?: string }> {
  const own = await actingPitStore(storeId);
  if (!own.store) return { error: own.error };
  const r = await setCertificateMediaPublic(mediaId, own.store.id, wantPublic);
  if (r.ok) revalidate(certificateId, storeId);
  return r;
}

export async function removeCertMedia(
  mediaId: string,
  certificateId: string,
  storeId?: string,
): Promise<{ ok?: true; error?: string }> {
  const own = await actingPitStore(storeId);
  if (!own.store) return { error: own.error };
  const r = await deleteCertificateMedia(mediaId, own.store.id);
  if (r.ok) revalidate(certificateId, storeId);
  return r;
}

function revalidate(certificateId: string, storeId?: string): void {
  revalidatePath(`/dealer/pit/certificates/${certificateId}`);
  if (storeId) revalidatePath(`/hq/pit/certificates/${certificateId}`);
}
