import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { exportStoreRecordsCsv } from "@/server/pit/legal-record";

/*
 * 施工記録（施工証明書）の一括エクスポート。
 *
 * なぜ必要か: **加盟店が退会しても、法定記録簿の保存義務（記載の日から2年）は事業者本人に残る。**
 * したがって「退会したら記録が取り出せない」状態を作ってはいけない。
 * 加盟店自身と本部のどちらからでも、いつでも記録をCSVで持ち出せるようにしてある。
 *
 *  - 加盟店: 自店の記録のみ（storeIdは無視してセッションから解決する）
 *  - 本部: ?storeId= で任意の店舗（退会処理の代行・監査対応）
 *  - CSVには車台番号・氏名・住所を含む（記録簿の記載事項）。復号は監査ログ必須の経路のみ通る
 *  - キャッシュさせない（個人情報を含むため）
 */
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return text(401, "ログインしてください");

  const requested = request.nextUrl.searchParams.get("storeId") ?? "";
  let storeId: string;
  if (user.role === "HQ_ADMIN") {
    if (!requested) return text(400, "storeId を指定してください");
    storeId = requested;
  } else {
    if (!user.dealerId) return text(403, "店舗アカウントでログインしてください");
    const own = await prisma.pitStore.findUnique({ where: { dealerId: user.dealerId }, select: { id: true } });
    if (!own) return text(403, "この店舗はmbPITに登録されていません");
    storeId = own.id; // 他店のIDを渡されても自店に固定する
  }

  const { csv, count, storeName } = await exportStoreRecordsCsv(storeId, {
    actorUserId: user.id,
    actorRole: user.role === "HQ_ADMIN" ? "hq" : "dealer",
    purpose: "施工記録の一括エクスポート",
  });

  // ファイル名に日本語を入れるとブラウザで壊れることがあるためASCIIに寄せ、filename* で正式名を渡す
  const stamp = new Date().toISOString().slice(0, 10);
  const ascii = `mbpit-records-${stamp}.csv`;
  const jp = encodeURIComponent(`mbPIT施工記録_${storeName || storeId}_${stamp}.csv`);
  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${jp}`,
      "cache-control": "no-store",
      "x-record-count": String(count),
    },
  });
}

function text(status: number, message: string) {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
