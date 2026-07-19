import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/authz";
import { prisma } from "@/lib/db";
import { runPitPipeline } from "@/server/pit/pipeline";
import { pitAiEnabled } from "@/server/pit/generate";
import { wpConfigured } from "@/server/pit/wordpress";

// 本店専用: 任意の店舗としてテスト投稿し、記事品質を確認するためのエンドポイント。
// 実際に mbfasttuning.com に公開されるので注意（公開後はWordPress側で下書きに戻せる）。
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (user.role !== "HQ_ADMIN") return Response.json({ error: "Forbidden" }, { status: 403 });

  if (!pitAiEnabled()) return Response.json({ error: "ANTHROPIC_API_KEY が未設定です" }, { status: 503 });
  if (!wpConfigured()) return Response.json({ error: "WP_USER / WP_APP_PASSWORD が未設定です" }, { status: 503 });

  const form = await request.formData();
  const storeId = String(form.get("storeId") ?? "");
  const vehicle = String(form.get("vehicle") ?? "").trim();
  const category = String(form.get("category") ?? "other");
  const memo = String(form.get("memo") ?? "").trim();

  const store = await prisma.pitStore.findUnique({
    where: { id: storeId },
    select: { id: true, displayName: true, slug: true, wpCategoryId: true, footerHtml: true, faqJson: true },
  });
  if (!store) return Response.json({ error: "店舗が見つかりません" }, { status: 404 });
  if (!vehicle) return Response.json({ error: "車種を入力してください" }, { status: 400 });

  const files = form.getAll("photos").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return Response.json({ error: "写真を1枚以上追加してください" }, { status: 400 });

  const photos = [];
  for (const f of files) photos.push({ buffer: Buffer.from(await f.arrayBuffer()) });

  const result = await runPitPipeline({ store, vehicle, category, memo: memo || null, photos });
  return Response.json(result, { status: result.status === "failed" ? 500 : 200 });
}
