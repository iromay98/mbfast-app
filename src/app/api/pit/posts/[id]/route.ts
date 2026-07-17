import { getSessionUser, isSessionLive } from "@/lib/authz";
import { prisma } from "@/lib/db";

/*
 * GET /api/pit/posts/{id} — 投稿の処理状態（完了画面のポーリング用）。
 * 自店の投稿（または本部）のみ参照可。
 * message は店舗向けの平易な文言（保留の内部理由はそのまま出さない）。
 */

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const user = await getSessionUser();
  if (!user || !(await isSessionLive(user))) {
    return Response.json({ error: "ログインしてください" }, { status: 401 });
  }
  const { id } = await params;
  const post = await prisma.pitPost.findUnique({
    where: { id },
    select: { id: true, status: true, publishedUrl: true, title: true, dealerId: true, error: true },
  });
  if (!post) return Response.json({ error: "投稿が見つかりません" }, { status: 404 });
  if (user.role !== "HQ_ADMIN" && user.dealerId !== post.dealerId) {
    return Response.json({ error: "権限がありません" }, { status: 403 });
  }

  const message =
    post.status === "PROCESSING"
      ? "記事を作成しています。しばらくお待ちください（数分かかることがあります）"
      : post.status === "PUBLISHED"
        ? "記事を公開しました"
        : post.status === "HELD"
          ? "内容確認のため公開を保留しました。本部が確認後にご連絡します"
          : "記事の作成に失敗しました。時間をおいて再投稿するか、本部にお問い合わせください";

  return Response.json(
    {
      id: post.id,
      status: post.status,
      publishedUrl: post.publishedUrl,
      title: post.title,
      message,
      // エラー詳細は本部のみ（店舗には平易な message を表示）
      ...(user.role === "HQ_ADMIN" && post.error ? { error: post.error } : {}),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
