// WordPressページ本文（content.raw）の wp:html ブロック操作と正規化。
// prisma非依存の純粋関数のみ（スクリプトからも使う）。

// 数値文字参照（&#x1f4ac; / &#128172;）→ 生文字。WPエディタが保存時に絵文字等を
// 再エンコードするため、比較・payload_hash計算はこの正規化後に行う。
export function normalizeEntities(html: string): string {
  return html
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)));
}

// wp:html ブロックの位置（inner はマーカー間の生文字列）
export type WpHtmlBlock = {
  blockStart: number;
  blockEnd: number;
  innerStart: number;
  innerEnd: number;
  inner: string;
};

export function parseWpHtmlBlocks(content: string): WpHtmlBlock[] {
  const blocks: WpHtmlBlock[] = [];
  const re = /<!-- wp:html -->([\s\S]*?)<!-- \/wp:html -->/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    blocks.push({
      blockStart: m.index,
      blockEnd: m.index + m[0].length,
      innerStart: m.index + "<!-- wp:html -->".length,
      innerEnd: m.index + m[0].length - "<!-- /wp:html -->".length,
      inner: m[1],
    });
  }
  return blocks;
}

// 生成HTMLからブランドのラッパーclass属性（class="toyota-price-wrapper" 等）を取り出す。
// ブロック特定のマーカーとして使う（"mb-price-wrapper" と "mb-price-wrapper mb-diesel-wrapper" は
// class属性全体の完全一致で区別される）。
export function wrapperMarker(snippet: string): string {
  const m = /class="([^"]*price-wrapper[^"]*)"/.exec(snippet);
  if (!m) throw new Error("生成HTMLに price-wrapper が見つかりません");
  return `class="${m[1]}"`;
}

// thead の th テキスト列（タグ・空白除去、実体参照を正規化）。
// 列順の突き合わせ（自動同期のガード・verify-column-order）に使う。
export function theadSequence(html: string): string[] {
  const m = /<thead>([\s\S]*?)<\/thead>/.exec(html);
  if (!m) return [];
  return [...m[1].matchAll(/<th[^>]*>([\s\S]*?)<\/th>/g)].map((t) =>
    t[1].replace(/<[^>]+>/g, "").replace(/\s+/g, "").replace(/&amp;/g, "&"),
  );
}
