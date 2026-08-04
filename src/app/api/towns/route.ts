import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/authz";
import { PREFECTURES } from "@/lib/jp-geo";

/*
 * 都道府県＋市区町村 → 町域（大字）一覧。HeartRails Geo API をサーバー経由で取得。
 *
 * なぜ必要か: /api/cities は「市区町村」までしか返さない。政令指定都市では区が、
 * それ以外でも町域が選べず、番地より上を手入力させていた（表記ゆれの元）。
 *
 * 町域は合併・住居表示変更で変わるため静的データは持たない。
 * 取得できない場合はクライアントが手入力にフォールバックする（入力自体は止めない）。
 */
const cache = new Map<string, { at: number; towns: string[] }>();
const TTL = 24 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "ログインしてください" }, { status: 401 });

  const url = new URL(request.url);
  const pref = url.searchParams.get("pref") ?? "";
  const city = (url.searchParams.get("city") ?? "").trim();
  if (!(PREFECTURES as readonly string[]).includes(pref)) {
    return Response.json({ error: "都道府県を指定してください" }, { status: 400 });
  }
  if (!city) return Response.json({ error: "市区町村を指定してください" }, { status: 400 });

  const key = `${pref}/${city}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL) return Response.json({ towns: hit.towns });

  try {
    const res = await fetch(
      `https://geoapi.heartrails.com/api/json?method=getTowns&prefecture=${encodeURIComponent(pref)}&city=${encodeURIComponent(city)}`,
      { signal: AbortSignal.timeout(8000) },
    );
    const data = (await res.json()) as { response?: { location?: { town: string }[] } };
    // 同じ町域が複数の郵便番号で返ることがあるので一意化する
    const towns = [...new Set((data.response?.location ?? []).map((l) => l.town).filter(Boolean))];
    if (towns.length === 0) throw new Error("empty");
    cache.set(key, { at: Date.now(), towns });
    return Response.json({ towns });
  } catch {
    return Response.json({ error: "町域一覧を取得できませんでした" }, { status: 502 });
  }
}
