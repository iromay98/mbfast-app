/*
 * mbPIT: WordPress側に店舗カテゴリがあるのにアプリ側に無い店舗を、店舗マスタへ登録する。
 *
 * なぜ必要か: **アプリの店舗マスタが投稿の起点**なので、WPにカテゴリだけあっても
 * その店舗はアプリから投稿できない（実例: Glanzcoat 555）。
 *
 * 安全のための決めごと:
 * - **既定はドライラン**。`--commit` を付けたときだけ書き込む
 * - WPカテゴリIDは**親545配下にあることをWPに問い合わせて確認**してから使う
 *   （既存の代理店カテゴリツリーを誤って紐付けない）
 * - slug と wpCategoryId が既に使われていたら中止（一意制約で落ちる前に止める）
 * - slugは英小文字のみ（表示名は日本語で良い。命名の原則）
 * - 代理店（ログインアカウント）は**作らない**。既存の代理店に紐付けるか、
 *   本店直営（dealerId=null＝本部が /hq/pit/post から代理投稿）にするかだけを選ぶ。
 *   パスワード発行を伴う代理店作成はこのスクリプトの責任範囲外
 *
 * 実行（本番コンテナ内）:
 *   npx tsx scripts/pit-add-store.mts --slug=glanzcoat --name=Glanzcoat --wp-category=555
 *   npx tsx scripts/pit-add-store.mts --slug=glanzcoat --name=Glanzcoat --wp-category=555 --dealer=<代理店ID>
 *   … 末尾に --commit を付けると書き込む
 */

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL が必要（本番コンテナ内で実行する前提）。");
  process.exit(2);
}

const argv = process.argv.slice(2);
const commit = argv.includes("--commit");
const arg = (k: string): string => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : "";
};

const slug = arg("slug").trim().toLowerCase();
const nameB64 = arg("name-b64").trim();
const name = (nameB64 ? Buffer.from(nameB64, "base64").toString("utf-8") : arg("name")).trim();
const wpCategoryId = Number(arg("wp-category"));
const dealerId = arg("dealer").trim();

if (!slug || !name || !Number.isInteger(wpCategoryId) || wpCategoryId <= 0) {
  console.error("使い方: --slug=<英小文字> --name=<表示名> --wp-category=<WPカテゴリID> [--dealer=<代理店ID>] [--commit]");
  process.exit(2);
}
if (!/^[a-z0-9-]+$/.test(slug)) {
  console.error("slugは英小文字・数字・ハイフンのみです（命名の原則: slugは英語／表示名は日本語）。");
  process.exit(2);
}

const { PrismaClient } = (await import("../src/generated/prisma/client")) as {
  PrismaClient: new (o: unknown) => unknown;
};
const { PrismaPg } = (await import("@prisma/adapter-pg")) as { PrismaPg: new (s: string) => unknown };
const { fetchMbpitCategories, wpConfigured, MBPIT_PARENT_CATEGORY_ID } = await import(
  "../src/server/pit/wordpress"
);

if (!wpConfigured()) {
  console.error("WP_USER / WP_APP_PASSWORD が未設定です（カテゴリの検証に必要）。");
  process.exit(2);
}

type Store = { id: string; displayName: string; slug: string; wpCategoryId: number; dealerId: string | null };
type Dealer = { id: string; name: string; status: string; pitOnly: boolean };

const adapter = new PrismaPg(process.env.DATABASE_URL);
const prisma = new PrismaClient({ adapter }) as {
  pitStore: {
    findMany: (a: unknown) => Promise<Store[]>;
    create: (a: unknown) => Promise<{ id: string; displayName: string; slug: string; wpCategoryId: number }>;
  };
  dealer: { findMany: (a: unknown) => Promise<Dealer[]>; findUnique: (a: unknown) => Promise<Dealer | null> };
  $disconnect: () => Promise<void>;
};

console.log(commit ? "== 店舗マスタへ登録（書き込み） ==" : "== 店舗マスタへ登録（ドライラン・書き込みなし） ==");
console.log(`  slug=${slug} 表示名=「${name}」 WPカテゴリ=${wpCategoryId}`);
console.log("");

let bad = false;
const stop = (m: string) => {
  console.error(`  ❌ ${m}`);
  bad = true;
};

// 1. WP側の検証: そのカテゴリIDが親545配下に実在するか
const terms = await fetchMbpitCategories();
const term = terms.find((t) => t.id === wpCategoryId);
if (!term) {
  stop(
    `WPカテゴリ ${wpCategoryId} が親${MBPIT_PARENT_CATEGORY_ID}配下に見つかりません。` +
      `545直下のID: ${terms.map((t) => t.id).join(", ")}`,
  );
} else {
  console.log(`  WP側: ${term.id} name="${term.name}" slug="${term.slug}" 記事${term.count}件`);
  if (term.slug !== slug && term.slug !== `${slug}-mbpit`) {
    console.log(`  ※ WPのカテゴリslug「${term.slug}」と指定slug「${slug}」が一致しません。`);
    console.log(`     取込(job=slug)を回すとWP側に揃えられるため、意図した値か確認してください。`);
  }
}

// 2. アプリ側の検証: slug と wpCategoryId の重複
const stores = await prisma.pitStore.findMany({
  select: { id: true, displayName: true, slug: true, wpCategoryId: true, dealerId: true },
});
const bySlug = stores.find((s) => s.slug === slug);
if (bySlug) stop(`slug「${slug}」は既に「${bySlug.displayName}」が使っています`);
const byCat = stores.find((s) => s.wpCategoryId === wpCategoryId);
if (byCat) stop(`WPカテゴリ ${wpCategoryId} は既に「${byCat.displayName}」に紐付いています`);

// 3. 代理店の指定（省略時は本店直営）
let dealer: Dealer | null = null;
if (dealerId) {
  dealer = await prisma.dealer.findUnique({
    where: { id: dealerId },
    select: { id: true, name: true, status: true, pitOnly: true },
  });
  if (!dealer) stop(`代理店ID「${dealerId}」が見つかりません`);
  else {
    const taken = stores.find((s) => s.dealerId === dealer!.id);
    if (taken) stop(`代理店「${dealer.name}」には既に店舗「${taken.displayName}」が紐付いています`);
    console.log(`  代理店: ${dealer.name}（${dealer.status}${dealer.pitOnly ? " / mbPIT専用" : ""}）`);
  }
} else {
  console.log("  代理店: 指定なし → **本店直営**として登録（本部が /hq/pit/post から代理投稿する形）");
  // 名前が近い既存代理店を出す。紐付けるべきものがあるなら --dealer で指定し直せる
  const words = name.replace(/[^\p{L}\p{N}]+/gu, " ").split(" ").filter((w) => w.length >= 3);
  const cands = await prisma.dealer.findMany({
    where: { OR: words.map((w) => ({ name: { contains: w, mode: "insensitive" } })) },
    select: { id: true, name: true, status: true, pitOnly: true },
    take: 10,
  });
  if (cands.length) {
    console.log("");
    console.log("  ── 名前が近い既存の代理店（紐付けるなら --dealer=<ID> を付け直す） ──");
    for (const c of cands) {
      const used = stores.some((s) => s.dealerId === c.id);
      console.log(`    ${c.id} ${c.name}（${c.status}${c.pitOnly ? " / mbPIT専用" : ""}）${used ? " ← 既に別店舗が紐付き" : ""}`);
    }
  } else {
    console.log("  （名前が近い既存の代理店は見つかりませんでした）");
  }
}

console.log("");
if (bad) {
  console.error("問題があるため登録しません。");
  await prisma.$disconnect();
  process.exit(1);
}

if (!commit) {
  console.log("この内容で登録できます。書き込むには --commit を付けて実行してください。");
  await prisma.$disconnect();
  process.exit(0);
}

const created = await prisma.pitStore.create({
  data: {
    dealerId: dealer ? dealer.id : null,
    displayName: name,
    slug,
    wpCategoryId,
    footerHtml: "",
    active: true,
  },
  select: { id: true, displayName: true, slug: true, wpCategoryId: true },
});
console.log(`  ✅ 登録しました: ${created.displayName}（id=${created.id} slug=${created.slug} WP=${created.wpCategoryId}）`);
console.log("  店舗情報9項目は未設定です。/hq/pit の「店舗情報」から入力するとWPへ同期されます。");

await prisma.$disconnect();
