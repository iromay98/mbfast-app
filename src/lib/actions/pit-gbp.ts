"use server";

import { revalidatePath } from "next/cache";
import { requireHQ } from "@/lib/authz";
import {
  linkStoreToLocation,
  unlinkStore,
  setGbpPostingEnabled,
  type LinkInput,
} from "@/server/pit/gbp/link";

const PATH = "/hq/pit/gbp";

/*
 * Googleマップ投稿の紐付け操作。本部のみ。
 * 加盟店には触らせない（誤配信すると相手の資産に影響が出るため本部の責任で行う）。
 */
export async function linkGbpLocation(input: LinkInput): Promise<{ ok?: true; error?: string }> {
  const user = await requireHQ();
  const r = await linkStoreToLocation(input, user.id);
  if (r.ok) revalidatePath(PATH);
  return r;
}

export async function unlinkGbpLocation(storeId: string): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  const r = await unlinkStore(storeId);
  if (r.ok) revalidatePath(PATH);
  return r;
}

export async function toggleGbpPosting(
  storeId: string,
  enabled: boolean,
): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  const r = await setGbpPostingEnabled(storeId, enabled);
  if (r.ok) revalidatePath(PATH);
  return r;
}
