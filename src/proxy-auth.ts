// proxy 専用の軽量 NextAuth インスタンス（Prisma/bcrypt を含まない authConfig のみ）。
// これを proxy.ts から `export { auth as proxy }` で再エクスポートすることで、
// Next.js 16 の「proxy は関数をエクスポートすること」という静的チェックを満たす。
import NextAuth from "next-auth";
import { authConfig } from "@/auth.config";

export const { auth } = NextAuth(authConfig);
