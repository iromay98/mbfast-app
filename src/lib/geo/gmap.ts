/*
 * GoogleマップのURLから緯度経度を取り出す（純関数・依存なし）。
 *
 * 店舗に「緯度と経度を入力してください」と言っても伝わらないので、
 * 加盟店にはGoogleマップの共有URLを貼ってもらい、そこから座標を機械的に取る。
 *
 * 対応する形:
 *   https://www.google.com/maps/place/店名/@35.6595,139.7005,17z/...   ← @lat,lng
 *   https://www.google.com/maps/place/.../data=...!3d35.6595!4d139.7005 ← !3d!4d（より正確）
 *   https://www.google.com/maps?q=35.6595,139.7005
 *   https://maps.google.com/?ll=35.6595,139.7005
 *   35.6595,139.7005                                                    ← 座標を直接貼った場合
 *
 * 短縮URL（https://maps.app.goo.gl/xxxx・https://goo.gl/maps/xxxx）は
 * 展開しないと座標が入っていないため、ここでは取れない＝needsExpand を返す。
 * 展開はサーバー側（fetchでリダイレクト追跡）で行う。
 */

export type LatLng = { lat: number; lng: number };

/** 日本の領域内か（誤入力・緯度経度の取り違えを弾く） */
export function isInJapan({ lat, lng }: LatLng): boolean {
  return lat >= 20 && lat <= 46 && lng >= 122 && lng <= 154;
}

/** 座標を小数6桁（約0.1m精度）に丸める。桁を無限に持たせない */
export function roundLatLng({ lat, lng }: LatLng): LatLng {
  return { lat: Math.round(lat * 1e6) / 1e6, lng: Math.round(lng * 1e6) / 1e6 };
}

/** 短縮URL（展開が必要）かどうか */
export function isShortMapUrl(input: string): boolean {
  return /^https:\/\/(maps\.app\.goo\.gl|goo\.gl\/maps)\//.test(input.trim());
}

/**
 * URLまたは「lat,lng」文字列から座標を取り出す。
 * 取れなければ null（呼び出し側でエラー表示）。
 */
export function parseLatLng(input: string): LatLng | null {
  const s = (input ?? "").trim();
  if (!s) return null;

  const candidates: LatLng[] = [];

  // !3d{lat}!4d{lng} … 地物そのものの座標。@ は「地図の中心」なのでこちらを優先する
  const d = s.match(/!3d(-?\d+(?:\.\d+)?)!4d(-?\d+(?:\.\d+)?)/);
  if (d) candidates.push({ lat: Number(d[1]), lng: Number(d[2]) });

  // /@{lat},{lng},{zoom}z
  const at = s.match(/@(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (at) candidates.push({ lat: Number(at[1]), lng: Number(at[2]) });

  // ?q= / ?ll= / ?center= / ?destination=
  const q = s.match(/[?&](?:q|ll|center|destination|daddr)=(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/);
  if (q) candidates.push({ lat: Number(q[1]), lng: Number(q[2]) });

  // 座標を直接貼った場合（URLでないときのみ。URL中の数字の誤爆を避ける）
  if (!/^https?:\/\//i.test(s)) {
    const raw = s.match(/^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/);
    if (raw) candidates.push({ lat: Number(raw[1]), lng: Number(raw[2]) });
  }

  for (const c of candidates) {
    if (!Number.isFinite(c.lat) || !Number.isFinite(c.lng)) continue;
    if (Math.abs(c.lat) > 90 || Math.abs(c.lng) > 180) continue;
    return roundLatLng(c);
  }
  return null;
}

/** 座標から地図リンクを作る（表示側で使う。座標があるときは住所検索より正確） */
export function mapUrlOf(pos: LatLng): string {
  const { lat, lng } = roundLatLng(pos);
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

/** 座標が無いときの代替リンク（店舗名＋住所で検索） */
export function mapSearchUrlOf(name: string, address: string): string {
  const q = [name, address].filter(Boolean).join(" ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}
