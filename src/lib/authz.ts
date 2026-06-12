import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { prisma } from "@/lib/db";

/**
 * サーバー側の認可ヘルパー。
 * 認可は必ずここを通して「サーバー側」で強制する（proxy だけに依存しない）。
 * ページ・サーバーアクション・ルートハンドラの冒頭で呼ぶこと。
 */

export type SessionUser = {
  id: string;
  name?: string | null;
  email?: string | null;
  role: "HQ_ADMIN" | "DEALER";
  dealerId: string | null;
};

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth();
  return (session?.user as SessionUser | undefined) ?? null;
}

/**
 * JWT クレームが現在も DB と整合するかを検証する。
 *
 * JWT は発行後に状態を持たない（ステートレス）ため、代理店を無効化しても既存セッションは
 * そのまま使えてしまう。そこで保護されたリクエスト毎に DB を 1 往復し、
 *  - User が実在すること
 *  - DEALER は dealerId が一致し かつ 所属 Dealer が ACTIVE であること
 * を確認する。満たさなければセッションは「失効済み」として扱う。
 * （毎リクエストの DB アクセス増は、無効化を即時反映するための許容コスト）
 *
 * getSessionUser() ではなくこの関数で判定を統一することで、保護ページ・認可ゲート・
 * /login の「ログイン済みなら退避」判定が全て同じ結論になり、失効済み⇄/login の
 * リダイレクトループを防ぐ。
 */
export async function isSessionLive(user: SessionUser): Promise<boolean> {
  if (user.role === "DEALER") {
    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { dealerId: true, dealer: { select: { status: true } } },
    });
    return (
      !!dbUser &&
      dbUser.dealerId === user.dealerId &&
      dbUser.dealer?.status === "ACTIVE"
    );
  }
  // HQ_ADMIN: 所属 Dealer は無いので User の実在のみ確認（削除済みアカウントを弾く）。
  const dbUser = await prisma.user.findUnique({
    where: { id: user.id },
    select: { id: true },
  });
  return !!dbUser;
}

/** ログイン必須。未ログイン or セッション失効済みなら /login へ。 */
export async function requireUser(): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (!(await isSessionLive(user))) redirect("/login");
  return user;
}

/** 本店管理者必須。違えば自分のエリアへ退避（redirect は実行を中断する）。 */
export async function requireHQ(): Promise<SessionUser> {
  const user = await requireUser();
  if (user.role !== "HQ_ADMIN") redirect("/dealer");
  return user;
}

/** 代理店必須。dealerId 付きを保証して返す。（Dealer の ACTIVE 検証は requireUser で実施済み） */
export async function requireDealer(): Promise<SessionUser & { dealerId: string }> {
  const user = await requireUser();
  if (user.role !== "DEALER" || !user.dealerId) redirect("/hq");
  return { ...user, dealerId: user.dealerId };
}

/** 代理店が自店リソースのみ操作できることを保証する。 */
export function assertOwnsDealer(user: SessionUser, dealerId: string): void {
  if (user.role === "HQ_ADMIN") return; // 本店は全代理店アクセス可
  if (user.dealerId !== dealerId) {
    throw new Error("この代理店のデータにアクセスする権限がありません");
  }
}
