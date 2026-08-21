/*
 * 施工記録から、媒体ごとの投稿文を作る（純関数・外部依存なし）。
 *
 * 同じ文章を全SNSに流すと全部で滑る。媒体ごとに読まれ方が違うため:
 *   X          … 短い。改行が効く。ハッシュタグは2〜3個まで（多いと逆に伸びない）
 *   Instagram  … 画像が主役。本文は長くてよく、タグは多めが機能する
 *   Threads    … Xより少し長め。タグ文化は薄い
 *   Googleマップ… 検索文脈。一覧では先頭80〜100字しか読まれない（map-post-text.ts）
 *
 * 文面をここに集約するのは、送信処理から切り離して検査できるようにするため。
 *   npm run check:social-text
 */

export type SocialProvider = "x" | "instagram" | "threads";

export type RecordInput = {
  /** 記事タイトル。「【施工記録】車種 作業内容｜店名」形式 */
  title: string;
  vehicle: string;
  /** 公式8ジャンル名（例: チューニング（エンジン・駆動系）） */
  genre?: string | null;
  /** 施工者のメモ（記事の元になった一言） */
  memo?: string | null;
  articleUrl: string;
  storeName: string;
};

/** 上限。超えると投稿APIが弾くので、送る前にこちらで収める */
export const LIMITS: Record<SocialProvider, number> = {
  x: 280, // 日本語は1文字1カウント
  instagram: 2200,
  threads: 500,
};

/** タイトルから装飾と店名を落とし、車種＋作業内容だけにする */
export function coreTitle(title: string): string {
  return title
    .replace(/^【[^】]*】/, "")
    .split("｜")[0]
    .trim();
}

/** ジャンル名からハッシュタグを作る。記号や括弧はタグに使えないので落とす */
function genreTags(genre?: string | null): string[] {
  if (!genre) return [];
  const base = genre.replace(/（[^）]*）/g, "").replace(/[・\s]/g, "");
  return base ? [`#${base}`] : [];
}

/** 車種からタグを作る。「BMW X5M Competition」→ #BMW */
function vehicleTags(vehicle: string): string[] {
  const first = vehicle.trim().split(/[\s　]/)[0];
  if (!first) return [];
  return [`#${first.replace(/[^\p{L}\p{N}]/gu, "")}`].filter((t) => t.length > 1);
}

/** 指定文字数に収める。URLは必ず残す＝末尾から本文を削る */
function fit(body: string, tail: string, limit: number): string {
  const room = limit - tail.length;
  if (room <= 0) return tail.trim();
  if (body.length <= room) return `${body}${tail}`;
  return `${body.slice(0, Math.max(0, room - 1)).trimEnd()}…${tail}`;
}

export function buildSocialText(provider: SocialProvider, r: RecordInput): string {
  const head = coreTitle(r.title) || `${r.vehicle} 施工記録`;
  const memo = (r.memo ?? "").trim();

  if (provider === "x") {
    // Xはリンクが23字固定でカウントされる。タグは絞る（多いと伸びない）
    const tags = [...vehicleTags(r.vehicle), ...genreTags(r.genre)].slice(0, 3).join(" ");
    const tail = `\n\n${r.articleUrl}${tags ? `\n${tags}` : ""}`;
    const body = memo ? `${head}\n\n${memo}` : head;
    return fit(body, tail, LIMITS.x);
  }

  if (provider === "threads") {
    const tail = `\n\n${r.articleUrl}`;
    const body = memo ? `${head}\n\n${memo}` : head;
    return fit(body, tail, LIMITS.threads);
  }

  // instagram: 画像が主役。本文は丁寧に、タグは多めに効かせる
  const tags = [
    ...vehicleTags(r.vehicle),
    ...genreTags(r.genre),
    "#施工記録",
    "#mbPIT",
  ].filter((t, i, a) => a.indexOf(t) === i);
  // Instagramは本文中のURLがリンクにならないので、プロフィール誘導を明記する
  const tail = `\n\n詳しい施工内容はプロフィールのリンクから\n${r.articleUrl}\n\n${tags.join(" ")}`;
  const body = memo ? `${head}\n\n${memo}` : head;
  return fit(body, tail, LIMITS.instagram);
}
