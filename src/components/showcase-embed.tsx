import { normalizeEmbeds, type ShowcaseEmbed } from "@/lib/showcase/embed";

// 埋め込み1件を表示。動画/Instagramはiframe（DLせず公式埋め込み）、その他はリンクカード。
function EmbedItem({ e }: { e: ShowcaseEmbed }) {
  if (e.kind === "youtube" && e.embedUrl) {
    return (
      <div className="relative w-full overflow-hidden rounded-lg bg-black" style={{ aspectRatio: "16 / 9" }}>
        <iframe
          src={e.embedUrl}
          title={e.title ?? "YouTube"}
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          loading="lazy"
          className="absolute inset-0 h-full w-full"
        />
      </div>
    );
  }
  if (e.kind === "instagram" && e.embedUrl) {
    return (
      <div className="mx-auto w-full max-w-[400px] overflow-hidden rounded-lg border border-line">
        <iframe
          src={e.embedUrl}
          title={e.title ?? "Instagram"}
          loading="lazy"
          scrolling="no"
          className="h-[540px] w-full"
        />
      </div>
    );
  }
  // リンク（ブログ等）
  let host = e.url;
  try {
    host = new URL(e.url).hostname.replace(/^www\./, "");
  } catch {
    /* そのまま */
  }
  return (
    <a
      href={e.url}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 text-sm hover:bg-surface-2"
    >
      <span className="text-gold-600">🔗</span>
      <span className="min-w-0 flex-1 truncate font-medium text-ink">{e.title ?? e.url}</span>
      <span className="shrink-0 text-xs text-ink-soft">{host}</span>
    </a>
  );
}

// 事例の埋め込み一覧（JSONを正規化して描画）。
export function ShowcaseEmbeds({ embeds }: { embeds: unknown }) {
  const items = normalizeEmbeds(embeds);
  if (items.length === 0) return null;
  return (
    <div className="space-y-3">
      {items.map((e, i) => (
        <EmbedItem key={i} e={e} />
      ))}
    </div>
  );
}
