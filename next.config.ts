import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker / VPS 向けに最小ランタイムを出力（.next/standalone）
  output: "standalone",
  // Prisma 7 のドライバアダプタ等をサーバー外部パッケージとして扱う
  serverExternalPackages: ["@prisma/adapter-pg", "pg"],
  experimental: {
    // サーバーアクション経由アップロードの上限。スレーブ/mod ファイル(数〜数十MB)対応。
    // 既定は 1MB のため、アプリの MAX_UPLOAD_BYTES(50MB)＋multipart 余裕分まで引き上げる。
    serverActions: { bodySizeLimit: "60mb" },
  },
};

export default nextConfig;
