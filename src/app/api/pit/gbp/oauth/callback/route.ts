import type { NextRequest } from "next/server";
import { redirect } from "next/navigation";
import { requireDealer } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { exchangeCode, verifyState } from "@/server/pit/gbp/self-auth";
import { encryptToken, tokenCryptoConfigured } from "@/server/pit/gbp/token-crypto";
import { GbpError } from "@/server/pit/gbp/client";
import { notify } from "@/server/notifications";

const BACK = "/dealer/pit/gbp";

function back(msg: string): never {
  redirect(`${BACK}?msg=${encodeURIComponent(msg)}`);
}

/*
 * Googleからの戻り（方式B）。
 *
 * 二重の確認をする:
 *  1. state の署名 … 細工されたURLで別店舗に結び付けられるのを防ぐ
 *  2. ログイン中のユーザーの店舗と一致するか … state が漏れた場合の保険
 * どちらか欠けると、他店のビジネスプロフィールを別の店に紐付けられてしまう。
 *
 * この時点では**ロケーションはまだ選ばせない**。トークンを保存するだけにして、
 * どの店舗（拠点）を使うかは次の画面で本人に選んでもらう（2拠点ある店があるため）。
 */
export async function GET(request: NextRequest) {
  const user = await requireDealer();
  const url = new URL(request.url);

  const err = url.searchParams.get("error");
  if (err) {
    back(err === "access_denied" ? "連携をキャンセルしました。" : `連携できませんでした（${err}）`);
  }

  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!code || !state) back("連携の情報が不足しています。もう一度お試しください。");

  const verified = verifyState(state);
  if (!verified) back("連携の有効期限が切れました。もう一度お試しください。");

  const store = await prisma.pitStore.findUnique({
    where: { dealerId: user.dealerId },
    select: { id: true, displayName: true },
  });
  // state の店舗と、いまログインしている人の店舗が一致しない＝取り違え。必ず止める
  if (!store || store.id !== verified.storeId) {
    back("連携先の店舗が一致しません。ログインし直してからお試しください。");
  }

  if (!tokenCryptoConfigured()) {
    back("連携の設定が未完了です。本部にご連絡ください。");
  }

  let refreshToken: string;
  try {
    const r = await exchangeCode(code);
    refreshToken = r.refreshToken;
  } catch (e) {
    back(e instanceof GbpError ? e.message : "連携に失敗しました。時間をおいてお試しください。");
  }

  await prisma.pitStore.update({
    where: { id: store.id },
    data: {
      gbpAuthMode: "SELF",
      gbpRefreshTokenEnc: encryptToken(refreshToken),
      gbpAuthEmail: user.email ?? "",
      gbpAuthAt: new Date(),
      gbpAuthRevokedAt: null,
      // 連携しただけでは投稿しない。拠点を選び、本部が有効化してから
      gbpPostingEnabled: false,
    },
  });

  await notify({
    type: "PIT_STORE_APPLIED",
    title: "mbPIT 加盟店がGoogleマップと連携しました",
    message: `${store.displayName}（${user.email ?? "-"}）が自分でGoogle連携を完了しました。拠点の選択状況を確認してください。`,
    link: "/hq/pit/gbp",
  });

  redirect(`${BACK}?msg=${encodeURIComponent("Googleとの連携が完了しました。続けて店舗（拠点）を選んでください。")}`);
}
