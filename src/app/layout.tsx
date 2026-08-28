import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/sw-register";

export const metadata: Metadata = {
  title: "mbPIT",
  description: "記録が、集客と信頼に変わる。mbPIT 加盟店アプリ（施工記録・証明書・Googleマップ連携）",
  manifest: "/manifest.webmanifest",
  /*
   * ホーム画面アイコン。**iOSはmanifestのiconsを見ない**ので apple を別に指定する。
   * ここが無いと、iPhoneでホーム画面に追加したときにページの縮小画像になる
   * （実際に「無地のまま」に見えていた原因）。
   */
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [{ url: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: "mbPIT",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#b8862b",
  // iPhoneで env(safe-area-inset-*) を有効にする（下タブバーをホームバーと被らせない）
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // フォントは system-ui ベース（globals.css）。外部フォント取得に依存しない。
  return (
    <html lang="ja" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        {children}
        <ServiceWorkerRegister />
      </body>
    </html>
  );
}
