/*
 * 店舗のGoogleマップURL → 緯度経度の解決（サーバー側）。
 *
 * 加盟店は「共有」ボタンで出てくる短縮URL（https://maps.app.goo.gl/xxxx）を貼ることが多い。
 * 短縮URLには座標が入っていないので、リダイレクト先を1回だけ辿って実URLにしてから取り出す。
 *
 * 方針:
 * - 外部APIは使わない（Geocoding APIは有料。住所からの推定もしない＝間違った座標を作らない）
 * - 展開に失敗しても保存は止めない。座標が空のままなら表示側は住所検索リンクにフォールバックする
 * - 取れた座標が日本の範囲外なら捨てる（緯度経度の取り違え・別サービスのURL対策）
 */

import { isInJapan, isShortMapUrl, parseLatLng, type LatLng } from "@/lib/geo/gmap";

const TIMEOUT_MS = 5000;

/** 短縮URLを実URLに展開する。辿れなければ null */
async function expandShortUrl(url: string): Promise<string | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    // redirect: "follow" だと最終URLしか見えないが、それで十分（座標は最終URLに入る）
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: { "User-Agent": "Mozilla/5.0 (compatible; mbPIT/1.0)" },
    });
    return res.url || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * mapUrl から座標を解決する。
 * 返り値の pos が null のときは座標なし（表示側は住所検索にフォールバック）。
 */
export async function resolveStoreGeo(
  mapUrl: string,
): Promise<{ pos: LatLng | null; expandedUrl: string | null }> {
  const url = (mapUrl ?? "").trim();
  if (!url) return { pos: null, expandedUrl: null };

  let direct = parseLatLng(url);
  let expanded: string | null = null;

  if (!direct && isShortMapUrl(url)) {
    expanded = await expandShortUrl(url);
    if (expanded) direct = parseLatLng(expanded);
  }

  if (!direct) return { pos: null, expandedUrl: expanded };
  if (!isInJapan(direct)) return { pos: null, expandedUrl: expanded };
  return { pos: direct, expandedUrl: expanded };
}
