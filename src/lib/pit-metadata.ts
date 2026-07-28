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
