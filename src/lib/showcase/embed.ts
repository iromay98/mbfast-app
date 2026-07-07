// 事例に載せる外部メディアの埋め込み解決。
// 実体はダウンロード/再ホストせず、公式の埋め込みURL(iframe)かリンクで表示する（著作権配慮）。

export type EmbedKind = "youtube" | "instagram" | "link";

export type ShowcaseEmbed = {
  kind: EmbedKind;
  url: string; // 元URL（リンク表示・出典）
  embedUrl?: string; // iframe 用URL（YouTube/Instagram）
  title?: string;
};

function youtubeId(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, "");
    if (host === "youtu.be") return u.pathname.slice(1).split("/")[0] || null;
    if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
      if (u.pathname === "/watch") return u.searchParams.get("v");
      const m = u.pathname.match(/^\/(embed|shorts|v)\/([^/?#]+)/);
      if (m) return m[2];
    }
    return null;
  } catch {
    return null;
  }
}

function instagramCode(url: string): string | null {
  try {
    const u = new URL(url);
    if (!u.hostname.replace(/^www\./, "").endsWith("instagram.com")) return null;
    const m = u.pathname.match(/\/(p|reel|tv)\/([^/?#]+)/);
    return m ? m[2] : null;
  } catch {
    return null;
  }
}

// 1件のURLを埋め込み情報へ解決する。判別できないものは link として扱う。
export function resolveEmbed(url: string, title?: string): ShowcaseEmbed | null {
  const trimmed = url.trim();
  if (!trimmed) return null;

  const yt = youtubeId(trimmed);
  if (yt) {
    return {
      kind: "youtube",
      url: trimmed,
      embedUrl: `https://www.youtube-nocookie.com/embed/${yt}`,
      title,
    };
  }

  const ig = instagramCode(trimmed);
  if (ig) {
    return {
      kind: "instagram",
      url: trimmed,
      // Instagram公式の /embed はiframeで直接表示できる（外部JS不要）。
      embedUrl: `https://www.instagram.com/p/${ig}/embed`,
      title,
    };
  }

  return { kind: "link", url: trimmed, title };
}

// 保存済み JSON（unknown）を安全に ShowcaseEmbed[] へ正規化。
export function normalizeEmbeds(raw: unknown): ShowcaseEmbed[] {
  if (!Array.isArray(raw)) return [];
  const out: ShowcaseEmbed[] = [];
  for (const item of raw) {
    if (item && typeof item === "object" && typeof (item as { url?: unknown }).url === "string") {
      const e = resolveEmbed(
        (item as { url: string }).url,
        typeof (item as { title?: unknown }).title === "string"
          ? (item as { title: string }).title
          : undefined,
      );
      if (e) out.push(e);
    }
  }
  return out;
}
