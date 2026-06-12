import "dotenv/config"; // Prisma 7 は .env を自動読込しないため明示的にロード
import { defineConfig, env } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  // CLI / Migrate / Studio が使う接続先（実行時のアプリは src/lib/db.ts のアダプタ経由）
  datasource: {
    url: env("DATABASE_URL"),
  },
  migrations: {
    // npx prisma db seed で実行されるシードコマンド
    seed: "tsx prisma/seed.ts",
  },
});
