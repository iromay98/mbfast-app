/*
 * mbPIT: WordPress側のカテゴリslugに合わせて、アプリの店舗slugを揃える。
 *
 * なぜ必要か: 店舗が改名するとWP側でカテゴリ名とslugを変える。アプリのslugが古いままだと、
 * 記事末尾の「施工店」リンク（storePageUrl(store.slug) で本文へ焼き込まれる）が
 * 存在しないURLを指す。逆に、アプリだけ直してWPを直さないと**次のWP取込で巻き戻る**
 * （取込は WP のカテゴリslugを正としてアプリのslugを上書きするため）。
 *
 * 店舗情報の一括取込（ingestStoresFromWp）は9項目の店舗情報も上書きしてしまい、
 * アプリが原本のはずの値をWPの古い値で潰す危険がある。このスクリプトは
 * **slug と wpCategorySlug の2つしか触らない**。
 *
 * 安全のための決めごと:
 * - **既定はドライラン**。`--commit` を付けたときだけ書き込む
 * - 変更先slugが他店舗と衝突するなら書き込まない（一意制約で落ちる前に止める）
 * - WP側に対応するカテゴリが無い店舗、アプリ側に対応が無いWPカテゴリは**報告だけ**して触らない
 * - 店舗名（displayName）は触らない。アプリが原本なので、WPの名前で上書きしない
 *
 * 実行後は `pit-fix-store-links.mts` を回して、過去記事の焼き込みリンクを直すこと。
 *
 * 実行（本番コンテナ内）:
 *   npx tsx scripts/pit-sync-store-slug.mts            # ドライラン
 *   npx tsx scripts/pit-sync-store-slug.mts --commit   # 書き込み
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
const { fetchMbpitCategories, wpConfigured } = await import("../src/server/pit/wordpress");
const { shortSlugOf } = await import("../src/server/pit/store-meta");

if (!wpConfigured()) {
  console.error("WP_USER / WP_APP_PASSWORD が未設定です。WP認証のある環境で実行してください。");
  process.exit(2);
}

type Store = {
  id: string;
  displayName: string;
  slug: string;
  wpCategoryId: number;
  wpCategorySlug: string;
};

const adapter = new PrismaPg(process.env.DATABASE_URL);
const prisma = new PrismaClient({ adapter }) as {
  pitStore: {
    findMany: (a: unknown) => Promise<Store[]>;
    update: (a: unknown) => Promise<unknown>;
  };
  $disconnect: () => Promise<void>;
};

console.log(commit ? "== 店舗slug同期（書き込み） ==" : "== 店舗slug同期（ドライラン・書き込みなし） ==");
console.log("触るのは slug と wpCategorySlug のみ。店舗情報9項目・店舗名には触れません。");
console.log("");

const stores = await prisma.pitStore.findMany({
  select: { id: true, displayName: true, slug: true, wpCategoryId: true, wpCategorySlug: true },
  orderBy: { createdAt: "asc" },
});
const terms = await fetchMbpitCategories();

console.log(`アプリ ${stores.length}店 / WP側 親545配下 ${terms.length}カテゴリ`);
console.log("");

let changed = 0;
let ok = 0;
let blocked = 0;

for (const s of stores) {
  const term = terms.find((t) => t.id === s.wpCategoryId);
  if (!term) {
    console.log(`  ⚠ ${s.displayName}: WP側の545配下にカテゴリID ${s.wpCategoryId} が見つかりません（触りません）`);
    blocked++;
    continue;
  }
  const want = shortSlugOf(term.slug);
  if (want === s.slug && term.slug === s.wpCategorySlug) {
    console.log(`  =  ${s.displayName}: slug=${s.slug} 一致`);
    ok++;
    continue;
  }
  if (!/^[a-z0-9-]+$/.test(want)) {
    console.log(`  ⚠ ${s.displayName}: WPのslug「${term.slug}」から作った「${want}」が不正な形式（触りません）`);
    blocked++;
    continue;
  }
  const collision = stores.find((x) => x.id !== s.id && x.slug === want);
  if (collision) {
    console.log(`  ⚠ ${s.displayName}: 変更先slug「${want}」が「${collision.displayName}」と衝突（触りません）`);
    blocked++;
    continue;
  }

  const slugMove = want !== s.slug;
  console.log(
    `  +  ${s.displayName}: ` +
      (slugMove ? `slug ${s.slug} → ${want}` : `slug ${s.slug}（変更なし）`) +
      ` / wpCategorySlug ${s.wpCategorySlug || "（未取込）"} → ${term.slug}`,
  );
  if (slugMove) {
    console.log(`     ※ 過去記事のリンクは /mbpit/${s.slug}/ で焼き込まれています。`);
    console.log(`        この後 pit-fix-store-links.mts を回してください。`);
  }
  if (commit) {
    await prisma.pitStore.update({
      where: { id: s.id },
      data: { slug: want, wpCategorySlug: term.slug },
    });
    console.log(`     ✅ 更新しました`);
  }
  changed++;
}

// WP側にあってアプリ側に無いカテゴリ＝その店舗はアプリから投稿できない
const orphanTerms = terms.filter((t) => !stores.some((s) => s.wpCategoryId === t.id));
if (orphanTerms.length) {
  console.log("");
  console.log("── WP側にあってアプリ側に無いカテゴリ（この店舗はアプリから投稿できません） ──");
  for (const t of orphanTerms) {
    console.log(`  ${t.id} name="${t.name}" slug="${t.slug}" 記事${t.count}件`);
  }
}

// 店舗名の食い違いは報告だけ（アプリが原本なので勝手に直さない）
const nameDiff = stores
  .map((s) => ({ s, t: terms.find((t) => t.id === s.wpCategoryId) }))
  .filter((x) => x.t && x.t.name !== x.s.displayName);
if (nameDiff.length) {
  console.log("");
  console.log("── 店舗名の食い違い（アプリが原本。報告のみ・書き換えません） ──");
  for (const { s, t } of nameDiff) console.log(`  アプリ「${s.displayName}」 ⇄ WP「${t!.name}」(${t!.id})`);
}

console.log("");
console.log(`${commit ? "更新" : "更新予定"} ${changed} / 一致 ${ok} / 見送り ${blocked}`);
if (!commit && changed) console.log("書き込むには --commit を付けて実行してください。");

await prisma.$disconnect();
