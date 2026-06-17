import { getSessionUser } from "@/lib/authz";
import { vapidPublicKey, pushEnabled } from "@/server/push";

// クライアントが購読登録に使う VAPID 公開鍵を実行時に返す（ビルド時インライン不要）。
export async function GET() {
  const user = await getSessionUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  return Response.json(
    { key: pushEnabled() ? vapidPublicKey() : null },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
