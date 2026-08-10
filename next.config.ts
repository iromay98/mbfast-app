import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker / VPS 向けに最小ランタイムを出力（.next/standalone）
  output: "standalone",
  // Prisma 7 のドライバアダプタ等をサーバー外部パッケージとして扱う
  serverExternalPackages: ["@prisma/adapter-pg", "pg"],
  experimental: {
    // サーバーアクション経由アップロードの上限。アプリの MAX_UPLOAD_BYTES(200MB)＋
    // multipart 余裕分。案件チャットのスマホ動画（1分で60〜100MB超）が60mbの頃に
    // 軒並み失敗していたため引き上げた。ここを超えるとアプリに届く前に弾かれて
    // 不親切な失敗になるので、必ずアプリ側上限より大きくしておく
    serverActions: { bodySizeLimit: "210mb" },
    // proxy.ts（旧middleware）を通るリクエスト本体の上限。既定10MBを超えると本体が
    // 打ち切られ route handler 側の formData() が失敗する（mbPITの動画投稿がこれで落ちた）。
    // 案件チャット200MB＋mbPIT動画80MB＋写真＋multipart余裕分をカバーする値にする。
    proxyClientMaxBodySize: "220mb",
  },
};

export default nextConfig;
