"use server";

import { revalidatePath } from "next/cache";
import { requireDealer } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { GbpError, listLocationsWithToken } from "@/server/pit/gbp/client";
import { accessTokenFor, revokeToken } from "@/server/pit/gbp/self-auth";
import { decryptToken, tokenCryptoConfigured } from "@/server/pit/gbp/token-crypto";

/*
 * 方式B（加盟店が自分で連携する）の操作。
 *
 * 誤紐付けを防ぐ肝は「店主が自分のアカウントで自分の拠点を選ぶ」こと。
 * 本部が住所を見比べて推測する工程が無いので、店名が似た別店に投稿する事故が起きない。
 * 2拠点以上ある店のために選択式にしてある（自動で先頭を選ばない）。
 */

const PATH = "/dealer/pit/gbp";

type Own = { storeId: string; displayName: string; tokenEnc: string | null };

async function ownStore(): Promise<Own | { error: string }> {
  const user = await requireDealer();
  const store = await prisma.pitStore.findUnique({
    where: { dealerId: user.dealerId },
    select: { id: true, displayName: true, gbpRefreshTokenEnc: true },
  });
  if (!store) return { error: "この店舗はmbPITに登録されていません" };
  return { storeId: store.id, displayName: store.displayName, tokenEnc: store.gbpRefreshTokenEnc };
}

/** 連携済みのGoogleアカウントから、選べる拠点の一覧を取る */
export async function listMyGbpLocations(): Promise<{
  ok?: true;
  error?: string;
  needsReauth?: boolean;
  locations?: { accountId: string; locationId: string; title: string; address: string }[];
}> {
  const own = await ownStore();
  if ("error" in own) return { error: own.error };
  if (!tokenCryptoConfigured()) return { error: "連携の設定が未完了です。本部にご連絡ください。" };
  if (!own.tokenEnc) return { error: "まだGoogleと連携していません。" };

  const refresh = decryptToken(own.tokenEnc);
  // 鍵の入れ替え漏れ等で読めない＝再連携してもらうしかない（投稿は止める）
  if (!refresh) return { error: "連携情報を読み取れませんでした。お手数ですが再連携してください。", needsReauth: true };

  try {
    const token = await accessTokenFor(refresh);
    const locations = await listLocationsWithToken(token);
    return { ok: true, locations };
  } catch (e) {
    if (e instanceof GbpError && e.kind === "auth") {
      await prisma.pitStore.update({
        where: { id: own.storeId },
        data: { gbpAuthRevokedAt: new Date(), gbpPostingEnabled: false },
      });
      return { error: "Googleとの連携が切れています。再連携してください。", needsReauth: true };
    }
    return { error: e instanceof GbpError ? e.message : "拠点の取得に失敗しました。" };
  }
}

/** 店主が選んだ拠点を保存する */
export async function selectMyGbpLocation(input: {
  accountId: string;
  locationId: string;
  title: string;
  address: string;
}): Promise<{ ok?: true; error?: string }> {
  const own = await ownStore();
  if ("error" in own) return { error: own.error };

  if (!/^accounts\/[0-9]+$/.test(input.accountId)) return { error: "アカウントIDの形式が不正です" };
  if (!/^locations\/[0-9]+$/.test(input.locationId)) return { error: "拠点IDの形式が不正です" };

  // 同じ拠点を2店舗に割り当てない（別の加盟店が既に使っている場合は本部が調べる）
  const taken = await prisma.pitStore.findFirst({
    where: { gbpLocationId: input.locationId, NOT: { id: own.storeId } },
    select: { id: true },
  });
  if (taken) {
    return { error: "この拠点は既に別の店舗で使われています。本部にご連絡ください。" };
  }

  await prisma.pitStore.update({
    where: { id: own.storeId },
    data: {
      gbpAccountId: input.accountId,
      gbpLocationId: input.locationId,
      gbpLocationName: input.title,
      gbpLocationAddr: input.address,
      gbpLinkedAt: new Date(),
      // 選んだだけでは投稿しない。本部が内容確認の体制を整えてから有効化する
      gbpPostingEnabled: false,
    },
  });
  revalidatePath(PATH);
  return { ok: true };
}

/** 連携を解除する。Google側の許可も取り消す（DBから消すだけでは権限が残る） */
export async function disconnectMyGbp(): Promise<{ ok?: true; error?: string }> {
  const own = await ownStore();
  if ("error" in own) return { error: own.error };

  const refresh = own.tokenEnc ? decryptToken(own.tokenEnc) : null;
  if (refresh) await revokeToken(refresh);

  await prisma.pitStore.update({
    where: { id: own.storeId },
    data: {
      gbpAuthMode: "HQ",
      gbpRefreshTokenEnc: null,
      gbpAuthEmail: "",
      gbpAuthAt: null,
      gbpAuthRevokedAt: null,
      gbpAccountId: "",
      gbpLocationId: null,
      gbpLocationName: "",
      gbpLocationAddr: "",
      gbpLinkedAt: null,
      gbpPostingEnabled: false,
    },
  });
  revalidatePath(PATH);
  return { ok: true };
}
