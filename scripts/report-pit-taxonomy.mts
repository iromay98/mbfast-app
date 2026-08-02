/*
 * mbPIT: 投稿の区分（category）と店舗マスタの棚卸しレポート。**読み取り専用**。
 *
 * 用途: ポータル（WordPress）側でジャンル絞り込みを実装するにあたり、
 *   - 既存記事にアプリ側の区分が入っているか（＝タグを遡って付けられるか）
 *   - 店舗マスタに何店舗あり、WP側のカテゴリと対応しているか
 * を事実として出す。DBには一切書き込まない。
 *
 * 実行（本番コンテナ内）: npx tsx scripts/report-pit-taxonomy.mts
 */

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL が必要（本番コンテナ内で実行する前提）。");
  process.exit(2);
}

const { PrismaClient } = (await import("../src/generated/prisma/client")) as {
  PrismaClient: new (o: unknown) => unknown;
};
const { PrismaPg } = (await import("@prisma/adapter-pg")) as { PrismaPg: new (s: string) => unknown };
const adapter = new PrismaPg(process.env.DATABASE_URL);

type Post = {
  id: string;
  category: string;
  status: string;
  wpPostId: number | null;
  title: string | null;
  vehicle: string;
  createdAt: Date;
  store: { displayName: string; slug: string; wpCategoryId: number };
};
type Store = {
  id: string;
  displayName: string;
  slug: string;
  wpCategoryId: number;
  wpCategorySlug: string;
  active: boolean;
  dealerId: string | null;
  serviceTags: string;
  createdAt: Date;
};

const prisma = new PrismaClient({ adapter }) as {
  pitPost: { findMany: (a: unknown) => Promise<Post[]> };
  pitStore: { findMany: (a: unknown) => Promise<Store[]> };
  $disconnect: () => Promise<void>;
};

const CATEGORY_LABEL: Record<string, string> = {
  ecu: "ECUチューニング",
  coating: "コーティング",
  polish: "磨き",
  maintenance: "メンテナンス",
  other: "その他",
};

// ── 投稿 ───────────────────────────────────────────────────────
const posts = await prisma.pitPost.findMany({
  // draft（証明書から作ったスタンバイ）は記事ではないので除く
  where: { status: { not: "draft" } },
  select: {
    id: true, category: true, status: true, wpPostId: true, title: true,
    vehicle: true, createdAt: true,
    store: { select: { displayName: true, slug: true, wpCategoryId: true } },
  },
  orderBy: { createdAt: "asc" },
});

console.log("════════ 投稿（施工記録） ════════");
console.log(`件数: ${posts.length}（証明書から作った下書きスタンバイは除外）`);
console.log("");
console.log("WP記事ID | 区分         | 状態      | 店舗(WPカテゴリID) | 車種 | 作成日");
for (const p of posts) {
  const cat = `${p.category}(${CATEGORY_LABEL[p.category] ?? "?"})`;
  const wp = p.wpPostId ? String(p.wpPostId) : "—";
  const d = p.createdAt.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  console.log(
    `${wp.padStart(8)} | ${cat.padEnd(24)} | ${p.status.padEnd(9)} | ${p.store.displayName}(${p.store.wpCategoryId}) | ${p.vehicle} | ${d}`,
  );
}

console.log("");
console.log("── 区分ごとの件数 ──");
const byCat = new Map<string, number>();
for (const p of posts) byCat.set(p.category, (byCat.get(p.category) ?? 0) + 1);
for (const [k, v] of [...byCat.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(12)} ${CATEGORY_LABEL[k] ?? "?"}  ${v}件`);
}

// 遡及付与できるか＝WP記事IDと区分が揃っているか
const taggable = posts.filter((p) => p.wpPostId && p.category);
console.log("");
console.log(
  `遡及付与できる記事: ${taggable.length}/${posts.length}（WP記事IDと区分の両方がある＝アプリのデータだけでタグを付けられる）`,
);
const noWp = posts.filter((p) => !p.wpPostId);
if (noWp.length) {
  console.log(`  ※ WP記事IDが無い投稿 ${noWp.length}件（未公開/失敗）: ${noWp.map((p) => p.status).join(",")}`);
}

// ── 店舗 ───────────────────────────────────────────────────────
const stores = await prisma.pitStore.findMany({
  select: {
    id: true, displayName: true, slug: true, wpCategoryId: true, wpCategorySlug: true,
    active: true, dealerId: true, serviceTags: true, createdAt: true,
  },
  orderBy: { createdAt: "asc" },
});

console.log("");
console.log("════════ 店舗マスタ ════════");
console.log(`総数: ${stores.length}（有効 ${stores.filter((s) => s.active).length} / 停止 ${stores.filter((s) => !s.active).length}）`);
console.log("");
console.log("店舗名 | slug | WPカテゴリID | 状態 | 種別 | 対応内容(mbpit_tags) | 登録日");
for (const s of stores) {
  const kind = s.dealerId ? "加盟店" : "本店直営";
  const d = s.createdAt.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  console.log(
    `${s.displayName} | ${s.slug} | ${s.wpCategoryId} | ${s.active ? "有効" : "停止"} | ${kind} | ${s.serviceTags || "（未設定）"} | ${d}`,
  );
}

// 問い合わせのあった店舗名を明示的に照合する
console.log("");
console.log("── 特定の店舗の在否 ──");
for (const q of ["ユウキロジ", "ゆうきろじ", "ユウキ", "Yuki", "yuki"]) {
  const hit = stores.filter(
    (s) => s.displayName.includes(q) || s.slug.toLowerCase().includes(q.toLowerCase()),
  );
  if (hit.length) console.log(`  「${q}」に一致: ${hit.map((s) => `${s.displayName}(slug=${s.slug}, WP=${s.wpCategoryId})`).join(" / ")}`);
}
if (!stores.some((s) => /ユウキ|yuki/i.test(s.displayName + s.slug))) {
  console.log("  「ユウキロジ」に該当する店舗はアプリ側の店舗マスタに **ありません**");
}

await prisma.$disconnect();
