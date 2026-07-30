import type { NextRequest } from "next/server";
import { actingPitStore } from "@/server/pit/acting-store";
import { readCertificateMediaFile } from "@/server/pit/cert-media";

/*
 * 証跡写真の配信（店舗・本部向け）。
 * 保存キーは公開ディレクトリに無く、この経路以外から読めない。
 * 加盟店は自店の証明書のみ（storeId は acting-store が自店に固定する）。
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ mediaId: string }> }) {
  const { mediaId } = await ctx.params;
  const storeId = request.nextUrl.searchParams.get("storeId") ?? undefined;
  const own = await actingPitStore(storeId);
  if (!own.store) return new Response("Forbidden", { status: 403 });

  const file = await readCertificateMediaFile(mediaId, { scope: "store", storeId: own.store.id });
  if (!file) return new Response("Not Found", { status: 404 });

  return new Response(new Uint8Array(file.buffer), {
    headers: {
      "content-type": file.contentType,
      "content-length": String(file.buffer.byteLength),
      // 認可付きなので共有キャッシュには載せない
      "cache-control": "private, max-age=300",
    },
  });
}
