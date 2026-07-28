import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/authz";
import { PREFECTURES } from "@/lib/jp-geo";

// 都道府県 → 市区町村一覧（HeartRails Geo API・無料キー不要をサーバー経由で取得）。
// 市区町村は合併等で変わるため静的データは持たない。結果はプロセス内キャッシュ（1日）。
// 取得失敗時はクライアント側が手入力にフォールバックする。
const cache = new Map<string, { at: number; cities: string[] }>();
const TTL = 24 * 60 * 60 * 1000;

export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "ログインしてください" }, { status: 401 });

  const pref = new URL(request.url).searchParams.get("pref") ?? "";
  if (!(PREFECTURES as readonly string[]).includes(pref)) {
    return Response.json({ error: "都道府県を指定してください" }, { status: 400 });
  }

  const hit = cache.get(pref);
  if (hit && Date.now() - hit.at < TTL) return Response.json({ cities: hit.cities });

  try {
    const res = await fetch(
      `https://geoapi.heartrails.com/api/json?method=getCities&prefecture=${encodeURIComponent(pref)}`,
      { signal: AbortSignal.timeout(8000) },
    );
    const data = (await res.json()) as { response?: { location?: { city: string }[] } };
    const cities = (data.response?.location ?? []).map((l) => l.city).filter(Boolean);
    if (cities.length === 0) throw new Error("empty");
    cache.set(pref, { at: Date.now(), cities });
    return Response.json({ cities });
  } catch {
    return Response.json({ error: "市区町村一覧を取得できませんでした" }, { status: 502 });
  }
}
