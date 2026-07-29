/*
 * 生存確認だけを返す軽量エンドポイント（認証不要・DBに触らない）。
 * PWAが起動できなかったときの復帰待ち（public/offline.html）と、
 * デプロイのヘルスチェックが同じ判定を使えるようにする。
 */
export const dynamic = "force-dynamic";

export function GET() {
  return new Response("ok", {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
