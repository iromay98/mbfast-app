import type { Metadata, Viewport } from "next";
import "./globals.css";
import { ServiceWorkerRegister } from "@/components/sw-register";

export const metadata: Metadata = {
  title: "mbFAST 連携アプリ",
  description: "mbFAST 本店⇄代理店 連携アプリ（施工台帳・作業依頼・お知らせ）",
  manifest: "/manifest.webmanifest",
  appleWebApp: {
    capable: true,
    title: "mbFAST",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#b8862b",
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
