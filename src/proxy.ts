// Next.js 16: 旧 middleware は `proxy` に改称（Node.js ランタイムで動作）。
// 関数の名前付き再エクスポートにすることで静的解析が proxy 関数を認識できる。
export { auth as proxy } from "@/proxy-auth";

export const config = {
  // 静的アセット・画像最適化・API auth は除外。それ以外は proxy を通す。
  matcher: [
    "/((?!api/auth|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons|.*\\.png$).*)",
  ],
};
