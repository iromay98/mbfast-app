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
    // proxy.ts（旧middleware）を通るリクエスト本体の上限。既定10MBを超えると本体が
    // 打ち切られ route handler 側の formData() が失敗する（mbPITの動画投稿がこれで落ちた）。
    // mbPIT動画80MB＋写真10枚＋multipart余裕分をカバーする値にする。
    proxyClientMaxBodySize: "120mb",
  },
};

export default nextConfig;
