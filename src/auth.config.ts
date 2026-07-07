import type { NextAuthConfig } from "next-auth";

// proxy(旧 middleware) と本体 auth.ts で共有する設定。
// ここには Prisma/bcrypt を含めない（軽量に保ち、認可ゲートのみ担当）。
export const authConfig = {
  pages: {
    signIn: "/login",
  },
  session: {
    // credentials 方式では JWT セッション必須
    strategy: "jwt",
  },
  // 自前 VPS など任意ホストで動かすため
  trustHost: true,
  providers: [], // 実際のプロバイダ(Credentials)は auth.ts で注入
  callbacks: {
    // proxy で各リクエストのアクセス可否を判定（粗いゲート）。
    // 役割ごとの厳密な認可は各ページ/サーバーアクションの requireHQ/requireDealer で強制する。
    authorized({ auth, request: { nextUrl } }) {
      const user = auth?.user;
      const isLoggedIn = !!user;
      const path = nextUrl.pathname;

      // 認証不要のパス
      const isPublic =
        path === "/login" ||
        path.startsWith("/api/auth") ||
        path === "/showcase" ||
        path.startsWith("/showcase/") ||
        path === "/manifest.webmanifest" ||
        path === "/sw.js";
      if (isPublic) return true;

      if (!isLoggedIn) return false; // → signIn(/login) へリダイレクト

      // ログイン済み: ロール違いのエリアは自分のホームへ寄せる（UX 用。厳密判定はサーバー側）
      const role = user.role;
      if (path.startsWith("/hq") && role !== "HQ_ADMIN") {
        return Response.redirect(new URL("/dealer", nextUrl));
      }
      if (path.startsWith("/dealer") && role !== "DEALER") {
        return Response.redirect(new URL("/hq", nextUrl));
      }
      // ルートはロールに応じて振り分け
      if (path === "/") {
        return Response.redirect(
          new URL(role === "HQ_ADMIN" ? "/hq" : "/dealer", nextUrl),
        );
      }
      return true;
    },
    jwt({ token, user }) {
      // authorize() が返したユーザー（id は必ず存在）
      if (user?.id) {
        token.id = user.id;
        token.role = user.role;
        token.dealerId = user.dealerId;
        token.name = user.name ?? null;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = token.id;
        session.user.role = token.role;
        session.user.dealerId = token.dealerId;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
