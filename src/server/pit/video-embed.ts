/*
 * 施工動画のURL埋め込み。動画ファイルを自前サーバーに置くと容量が積み上がるため、
 * YouTube等の外部サービスに置いてURLだけ受け取る運用を主にする。
 *
 * セキュリティ: iframeを出すのは許可ホストのみ（任意URLをiframe化しない）。
 * Google Photos / iCloud の共有リンクは「動画ファイル」ではなくWebページで、
 * 埋め込み禁止＋リンク失効があるため対応しない（フォーム側で案内する）。
 */

export type ParsedVideo =
  | { kind: "youtube"; id: string; url: string }
  | { kind: "vimeo"; id: string; url: string }
  | { kind: "tiktok"; url: string }
  | { kind: "instagram"; url: string }
  | { kind: "unsupported"; url: string; reason: string };

const UNSUPPORTED_HINTS: { test: RegExp; reason: string }[] = [
  {
    test: /photos\.app\.goo\.gl|photos\.google\.com/i,
    reason: "Googleフォトの共有リンクは記事に埋め込めません（YouTubeに限定公開でアップしてURLを貼ってください）",
  },
  {
    test: /icloud\.com/i,
    reason: "iCloudの共有リンクは記事に埋め込めません（YouTubeに限定公開でアップしてURLを貼ってください）",
  },
  {
    test: /drive\.google\.com|dropbox\.com/i,
    reason: "ドライブ系の共有リンクは記事に埋め込めません（YouTubeに限定公開でアップしてURLを貼ってください）",
  },
];

/** 動画URLを判定する。許可サービス以外は unsupported（理由付き） */
export function parseVideoUrl(raw: string): ParsedVideo | null {
  const url = raw.trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) {
    return { kind: "unsupported", url, reason: "URLは http:// または https:// から始めてください" };
  }

  let host: string;
  try {
    host = new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return { kind: "unsupported", url, reason: "URLの形式が正しくありません" };
  }

  for (const h of UNSUPPORTED_HINTS) {
    if (h.test.test(url)) return { kind: "unsupported", url, reason: h.reason };
  }

  // YouTube: watch?v= / youtu.be/ / shorts/ / embed/
  if (/^(youtube\.com|m\.youtube\.com|youtube-nocookie\.com|youtu\.be)$/.test(host)) {
    const id =
      url.match(/[?&]v=([A-Za-z0-9_-]{11})/)?.[1] ??
      url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/)?.[1] ??
      url.match(/\/shorts\/([A-Za-z0-9_-]{11})/)?.[1] ??
      url.match(/\/embed\/([A-Za-z0-9_-]{11})/)?.[1];
    if (!id) return { kind: "unsupported", url, reason: "YouTubeの動画IDが読み取れませんでした" };
    return { kind: "youtube", id, url };
  }

  if (host === "vimeo.com" || host === "player.vimeo.com") {
    const id = url.match(/vimeo\.com\/(?:video\/)?(\d+)/)?.[1];
    if (!id) return { kind: "unsupported", url, reason: "Vimeoの動画IDが読み取れませんでした" };
    return { kind: "vimeo", id, url };
  }

  if (host === "tiktok.com" || host === "vt.tiktok.com" || host === "vm.tiktok.com") {
    return { kind: "tiktok", url };
  }

  if (host === "instagram.com") {
    return { kind: "instagram", url };
  }

  return {
    kind: "unsupported",
    url,
    reason: "対応しているのは YouTube・Vimeo・TikTok・Instagram のURLです",
  };
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/**
 * 記事本文用のGutenbergブロックを返す。
 * YouTube/Vimeoは自前のレスポンシブiframe（WP側のoEmbed設定に依存しない）、
 * TikTok/InstagramはWPのembedブロックに任せる（oEmbedが効かない場合もリンクとして残る）。
 */
export function videoEmbedHtml(v: ParsedVideo): string {
  const heading = `<!-- wp:heading {"level":2} --><h2>施工動画</h2><!-- /wp:heading -->`;
  const frame = (src: string, title: string) =>
    `<!-- wp:html --><div style="position:relative;width:100%;padding-top:56.25%;margin:0 0 1em">` +
    `<iframe src="${esc(src)}" title="${esc(title)}" loading="lazy" allowfullscreen ` +
    `allow="accelerometer;autoplay;clipboard-write;encrypted-media;gyroscope;picture-in-picture" ` +
    `referrerpolicy="strict-origin-when-cross-origin" frameborder="0" ` +
    `style="position:absolute;inset:0;width:100%;height:100%"></iframe></div><!-- /wp:html -->`;

  switch (v.kind) {
    case "youtube":
      // nocookieドメイン: 視聴者に不要なトラッキングCookieを置かない
      return `${heading}\n${frame(`https://www.youtube-nocookie.com/embed/${v.id}`, "施工動画")}`;
    case "vimeo":
      return `${heading}\n${frame(`https://player.vimeo.com/video/${v.id}`, "施工動画")}`;
    case "tiktok":
    case "instagram":
      return (
        `${heading}\n<!-- wp:embed {"url":"${esc(v.url)}","type":"video","providerNameSlug":"${v.kind}"} -->` +
        `<figure class="wp-block-embed is-type-video is-provider-${v.kind}">` +
        `<div class="wp-block-embed__wrapper">\n${esc(v.url)}\n</div></figure><!-- /wp:embed -->`
      );
    case "unsupported":
      return ""; // 呼び出し側で弾く（本文には出さない）
  }
}
