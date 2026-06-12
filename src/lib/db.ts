import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// Prisma 7: 実行時は schema の url ではなくドライバアダプタ(@prisma/adapter-pg)で接続する。
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("環境変数 DATABASE_URL が設定されていません (.env を確認)");
}

const adapter = new PrismaPg(connectionString);

// 開発時の HMR で接続が増殖しないようにグローバルへキャッシュ
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
