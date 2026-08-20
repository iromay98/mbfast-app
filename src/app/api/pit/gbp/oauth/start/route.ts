import { redirect } from "next/navigation";
import { requireDealer } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { authorizeUrl, selfAuthConfigured } from "@/server/pit/gbp/self-auth";

/*
 * 加盟店の「Googleと連携する」入口（方式B）。
 *
 * 自店以外を連携させないため、storeId はクエリで受け取らず**ログイン中のユーザーの
 * 所属店舗から引く**。state に署名を載せるのは戻り（callback）での取り違え防止。
 */
export async function GET() {
  const user = await requireDealer();

  const cfg = selfAuthConfigured();
  if (!cfg.ok) {
    return new Response(`連携の設定が未完了です（${cfg.missing.join(" / ")}）。本部にご連絡ください。`, {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const store = await prisma.pitStore.findUnique({
    where: { dealerId: user.dealerId },
    select: { id: true, active: true },
  });
  if (!store) {
    return new Response("この店舗はmbPITに登録されていません。", {
      status: 404,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }
  if (!store.active) {
    return new Response("店舗が有効化されていません。本部の承認をお待ちください。", {
      status: 403,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  redirect(authorizeUrl(store.id));
}
