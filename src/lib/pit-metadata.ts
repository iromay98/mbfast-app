import type { Metadata } from "next";

/*
 * mbPITブランドのホーム画面設定（マニフェスト＋アイコン）。
 * ルートlayoutはmbFASTなので、**mbPITとして見せるページは全部これを混ぜる**。
 * 混ぜ忘れると、そのページからホーム画面に追加したときだけmbFASTのアイコンになる
 * （実際に /pit/join・/pit/terms・/mycar が漏れていた）。
 * iOSはmanifestのiconsを見ないため apple-touch-icon の指定が必須。
 */
export const PIT_APP_ICONS = {
  manifest: "/manifest-pit.webmanifest",
  icons: {
    icon: [{ url: "/icons/pit-icon-192.png", sizes: "192x192", type: "image/png" }],
    apple: [{ url: "/icons/pit-apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
  },
} satisfies Pick<Metadata, "manifest" | "icons">;

/*
 * mbPIT加盟店向け画面のメタデータ（mbFASTの名前を出さない・別ブランド運用）。
 * ルートlayoutのmetadataを上書きするため、title/description/appleWebAppを必ず明示する。
 *
 * **ホーム画面のアイコンも分ける**: 以前は名前だけ mbPIT に上書きしていて、
 * アイコンはmbFAST共通のものが出ていた（加盟店のホーム画面に金色のmbFASTアイコンが並ぶ）。
 *  - manifest: mbPIT専用（名前・テーマ色・start_url・アイコンすべてmbPIT）
 *  - icons.apple: iOSはmanifestのiconsを見ないため apple-touch-icon を別途指定する
 */
export function pitMetadata(title: string): Metadata {
  return {
    title,
    description: "mbPIT 加盟店ポータル（施工記録の投稿・顧客カルテ・店舗情報）",
    ...PIT_APP_ICONS,
    appleWebApp: { capable: true, title: "mbPIT", statusBarStyle: "default" },
  };
}

/*
 * お客様・第三者に見せるページ（施工証明書の共有ページ・検証ページ）のメタデータ。
 * ルートlayoutの appleWebApp.title は "mbFAST" なので、明示的に上書きしないと
 * ホーム画面追加名やメタ情報にmbFASTの名前が出てしまう（mbPITは別ブランド運用）。
 * 検索エンジンには載せない。
 */
export function publicCertMetadata(title: string, description: string): Metadata {
  return {
    title,
    description,
    robots: { index: false, follow: false },
    appleWebApp: { capable: true, title, statusBarStyle: "default" },
    // お客様がこのページをホーム画面に追加してもmbFASTのアイコンにならないようにする
    ...PIT_APP_ICONS,
  };
}
