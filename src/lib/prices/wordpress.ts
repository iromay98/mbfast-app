// WordPress自動反映のインターフェース雛形（Phase 2以降で実装）。
// 現在の運用: generateBrandHtml → コピー or .htmlダウンロード → WordPressの該当固定ページに手動貼り付け。
// 自動化する場合は WordPress REST API（POST /wp-json/wp/v2/pages/{id}）+ Application Password を想定。

import type { BrandRow } from "./types";

export type PublishResult =
  | { ok: true; pageId: number; url?: string }
  | { ok: false; error: string };

export interface WordPressPublisher {
  /** brand.wordPressPageId の固定ページ本文を html で置き換える */
  publishBrand(brand: BrandRow, html: string): Promise<PublishResult>;
}

// 未設定時のプレースホルダ実装。環境変数が揃うまではエラーを返すだけ。
//   WORDPRESS_BASE_URL      例: https://mbfasttuning.com
//   WORDPRESS_USER          Application Password のユーザー名
//   WORDPRESS_APP_PASSWORD  Application Password（.env にのみ置く。コミット禁止）
export class NotConfiguredPublisher implements WordPressPublisher {
  async publishBrand(brand: BrandRow): Promise<PublishResult> {
    if (!brand.wordPressPageId) {
      return { ok: false, error: `${brand.displayName} に WordPressページID が設定されていません` };
    }
    return {
      ok: false,
      error:
        "WordPress連携は未実装です。生成したHTMLをコピーして該当ページに貼り付けてください（自動化は WORDPRESS_BASE_URL / WORDPRESS_USER / WORDPRESS_APP_PASSWORD 設定後に実装予定）。",
    };
  }
}

export function getWordPressPublisher(): WordPressPublisher {
  return new NotConfiguredPublisher();
}
