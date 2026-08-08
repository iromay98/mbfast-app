/*
 * mbPIT: 既存のWP記事から noindex を外す。
 *
 * なぜ必要か: mbPITをURL限定公開にしていた間（STEALTH_MODE）、投稿時に全記事へ
 * noindex を焼き込んでいた。検索に載せる方針へ切り替えた（新規投稿は既定でnoindexなし）が、
 * 既存記事はWP側に noindex が残ったままなので、後追いで解除する必要がある。
 *
 * 安全のための決めごと:
 * - **既定はドライラン**。`--commit` を付けたときだけWPに書き込む
 * - 触るのは AIOSEO の robots 設定（noindex）だけ。本文・タイトル・状態・カテゴリ・タグ・
 *   メタディスクリプション等には触れない
 * - 「サイト既定に従う」へ戻すだけ（clearPostNoindex）＝冪等で何度流しても同じ結果
 * - wpPostId が無い投稿（失敗・未作成）は対象外
 * - 削除済み（deleted）の記事は触らない（WPのゴミ箱にある想定・戻したときに改めて流せばよい）
 *
 * ドライランでは公開URLの実HTMLを見て robots メタの現状（noindexの有無）も確認する
 * （認証不要の読み取りのみ。下書きはURLが無いので一覧表示だけ）。
 *
 * 実行（本番コンテナ内・workflow job=noindex から呼ばれる）:
 *   npx tsx scripts/pit-clear-noindex.mts            # ドライラン
 *   npx tsx scripts/pit-clear-noindex.mts --commit   # 書き込み
 */

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL が必要（本番コンテナ内で実行する前提）。");
  process.exit(2);
}

const commit = process.argv.includes("--commit");

const { PrismaClient } = (await import("../src/generated/prisma/client")) as {
  PrismaClient: new (o: unknown) => unknown;
};
const { PrismaPg } = (await import("@prisma/adapter-pg")) as { PrismaPg: new (s: string) => unknown };
const { clearPostNoindex, wpConfigured } = await import("../src/server/pit/wordpress");

if (!wpConfigured()) {
  console.error("WP_USER / WP_APP_PASSWORD が未設定です。WP認証のある環境で実行してください。");
  process.exit(2);
}

type Post = {
  id: string;
  status: string;
  wpPostId: number | null;
  publishedUrl: string | null;
  title: string | null;
  vehicle: string;
  store: { displayName: string };
};

const adapter = new PrismaPg(process.env.DATABASE_URL);
const prisma = new PrismaClient({ adapter }) as {
  pitPost: { findMany: (a: unknown) => Promise<Post[]> };
  $disconnect: () => Promise<void>;
};

console.log(commit ? "== noindex解除（書き込み） ==" : "== noindex解除（ドライラン・書き込みなし） ==");
// 新規投稿側の状態も一緒に出す（コンテナのSTEALTH_MODEがtrueのままだと解除しても増え続ける）
console.log(`コンテナの STEALTH_MODE=${JSON.stringify(process.env.STEALTH_MODE ?? "(未設定=OFF)")}`);
console.log("");

const posts = await prisma.pitPost.findMany({
  where: { status: { in: ["published", "review"] }, wpPostId: { not: null } },
  select: {
    id: true, status: true, wpPostId: true, publishedUrl: true, title: true, vehicle: true,
    store: { select: { displayName: true } },
  },
  orderBy: { createdAt: "asc" },
});

console.log(`対象: ${posts.length}件（公開済み＋確認待ち下書き）`);
console.log("");

// 公開URLの robots メタを実測（読み取りのみ・認証不要）。キャッシュ等で読めなくても失敗にしない
async function robotsState(url: string): Promise<"noindex" | "index" | "不明"> {
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) return "不明";
    const html = await res.text();
    const robots = /<meta[^>]+name=["']robots["'][^>]*>/i.exec(html)?.[0] ?? "";
    return /noindex/i.test(robots) ? "noindex" : "index";
  } catch {
    return "不明";
  }
}

let cleared = 0;
let already = 0;
let unknown = 0;
let failed = 0;

for (const p of posts) {
  const wpId = p.wpPostId as number;
  const label = `WP:${wpId} [${p.status}] ${p.store.displayName} / ${p.title ?? p.vehicle}`;

  try {
    if (!commit) {
      if (p.status === "published" && p.publishedUrl) {
        const state = await robotsState(p.publishedUrl);
        if (state === "noindex") {
          console.log(`  +  ${label} → noindexあり（解除予定）`);
          cleared++;
        } else if (state === "index") {
          console.log(`  =  ${label} noindexなし（解除不要だが冪等なので流しても無害）`);
          already++;
        } else {
          console.log(`  ?  ${label} 現状を読めず（解除は実行される）`);
          unknown++;
        }
      } else {
        console.log(`  +  ${label} 下書きのためHTML確認不可（解除予定）`);
        cleared++;
      }
      continue;
    }
    await clearPostNoindex(wpId);
    console.log(`  ✅ ${label} → noindex解除`);
    cleared++;
  } catch (e) {
    console.error(`  ❌ ${label} 失敗: ${e instanceof Error ? e.message : String(e)}`);
    failed++;
  }
}

console.log("");
console.log(
  commit
    ? `解除 ${cleared} / 失敗 ${failed}`
    : `解除予定 ${cleared} / noindexなし ${already} / 現状不明 ${unknown} / 失敗 ${failed}`,
);
if (!commit) console.log("書き込むには --commit を付けて実行してください。");
if (commit) console.log("※ 再確認でnoindexが残って見える場合はページキャッシュの可能性があります（数分おいて再読込）。");

await prisma.$disconnect();
if (failed) process.exit(1);
