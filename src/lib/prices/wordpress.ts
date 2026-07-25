// WordPress REST API クライアント（価格表同期用）。
// 認証: Application Password（Basic）。WP_USER / WP_APP_PASSWORD は .env のみ（コミット禁止）。
// 更新は POST /wp-json/wp/v2/pages/{id}（このWPはPUT不可）。

const BASE = process.env.WP_BASE_URL ?? "https://mbfasttuning.com";
const API = `${BASE}/wp-json/wp/v2`;

export function wpConfigured(): boolean {
  return !!process.env.WP_USER && !!process.env.WP_APP_PASSWORD;
}

function authHeader(): string {
  const user = process.env.WP_USER;
  const pass = process.env.WP_APP_PASSWORD;
  if (!user || !pass) throw new Error("WP_USER / WP_APP_PASSWORD が未設定です");
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

export async function fetchPageRaw(pageId: number): Promise<{ id: number; slug: string; raw: string }> {
  const res = await fetch(`${API}/pages/${pageId}?context=edit&_fields=id,slug,content.raw`, {
    headers: { Authorization: authHeader() },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`WPページ取得(${pageId}): HTTP ${res.status} ${body.slice(0, 200)}`);
  }
  const data = (await res.json()) as { id: number; slug: string; content: { raw: string } };
  return { id: data.id, slug: data.slug, raw: data.content.raw };
}

export async function updatePageContent(pageId: number, content: string): Promise<void> {
  const res = await fetch(`${API}/pages/${pageId}`, {
    method: "POST",
    headers: { Authorization: authHeader(), "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`WPページ更新(${pageId}): HTTP ${res.status} ${body.slice(0, 200)}`);
  }
}
