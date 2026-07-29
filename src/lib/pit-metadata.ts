import type { Metadata } from "next";

// mbPIT加盟店向け画面のメタデータ（mbFASTの名前を出さない・別ブランド運用）。
// ルートlayoutのmetadataを上書きするため、title/description/appleWebAppを必ず明示する。
export function pitMetadata(title: string): Metadata {
  return {
    title,
    description: "mbPIT 加盟店ポータル（施工記録の投稿・顧客カルテ・店舗情報）",
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
  };
}
