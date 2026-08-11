/*
 * 車両ページの状態確認・切替CLI（/hq のUIができるまでのつなぎ。SQL不要で運用できるように）。
 *
 *   npm run vpages:set -- --list [brandId]                     … 一覧（slug / status / WPページID）
 *   npm run vpages:set -- --slug c-w204-c63amg --status draft  … status変更（hold/draft/publish）
 *   npm run vpages:set -- --slug c-w204-c63amg --option babble=on coldStartOff=off
 *   npm run vpages:set -- --slug c-w204-c63amg --related 20598 … 実績記事IDを紐付け（タイトル・URLはWPから取得）
 *   npm run vpages:set -- --slug c-w204-c63amg --reset-wp      … WPページIDの紐付けを解除（WP側で削除した後のやり直し用）
 *
 * 注意: ここで status を publish にしても、WPに反映されるのは vpages:wp-push を実行したときだけ。
 */
import { prisma } from "../src/lib/db";
import { OPTION_KEYS, type VehicleOptions } from "../src/lib/vehicle-pages/options";

const args = process.argv.slice(2);

function argAfter(flag: string): string | null {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] ? args[i + 1] : null;
}


if (args.includes("--list")) {
  const brandId = args[args.indexOf("--list") + 1];
  const onlyBrand = brandId && !brandId.startsWith("-") ? brandId : null;
  const pages = await prisma.vehiclePage.findMany({
    where: onlyBrand ? { vehicle: { brandId: onlyBrand } } : undefined,
    include: { vehicle: { select: { brandId: true, carName: true, grade: true } } },
    orderBy: { slug: "asc" },
  });
  for (const p of pages) {
    const wp = [p.wpPageIdJp ? `JP:${p.wpPageIdJp}` : "JP:-", p.wpPageIdEn ? `EN:${p.wpPageIdEn}` : "EN:-"].join(" ");
    console.log(`${p.status.padEnd(7)} ${p.slug.padEnd(36)} ${wp}  ${p.vehicle.carName} ${p.vehicle.grade ?? ""}`);
  }
  console.log(`\n合計 ${pages.length} 件`);
  process.exit(0);
}

const slug = argAfter("--slug");
if (!slug) {
  console.log("✗ --list か --slug を指定してください（先頭のコメント参照）");
  process.exit(1);
}

const page = await prisma.vehiclePage.findUnique({ where: { slug }, include: { vehicle: true } });
if (!page) {
  console.log(`✗ slug が見つかりません: ${slug}（vpages:set -- --list で確認）`);
  process.exit(1);
}

const status = argAfter("--status");
if (status) {
  if (!["hold", "draft", "publish"].includes(status)) {
    console.log("✗ status は hold / draft / publish のいずれか");
    process.exit(1);
  }
  await prisma.vehiclePage.update({ where: { id: page.id }, data: { status } });
  console.log(`✓ ${slug}: status ${page.status} → ${status}`);
}

const optIdx = args.indexOf("--option");
if (optIdx >= 0) {
  const pairs = args.slice(optIdx + 1).filter((a) => a.includes("="));
  const options = { ...(page.options as VehicleOptions) };
  for (const pair of pairs) {
    const [k, v] = pair.split("=");
    if (!OPTION_KEYS.includes(k) || !["on", "off"].includes(v)) {
      console.log(`✗ 不正な指定: ${pair}（キー: ${OPTION_KEYS.join("/")}、値: on/off）`);
      process.exit(1);
    }
    (options as Record<string, boolean>)[k] = v === "on";
  }
  await prisma.vehiclePage.update({ where: { id: page.id }, data: { options } });
  console.log(`✓ ${slug}: options = ${JSON.stringify(options)}`);
}

if (args.includes("--reset-wp")) {
  await prisma.vehiclePage.update({ where: { id: page.id }, data: { wpPageIdJp: null, wpPageIdEn: null } });
  console.log(`✓ ${slug}: WPページIDを解除（JP:${page.wpPageIdJp ?? "-"} EN:${page.wpPageIdEn ?? "-"} → null）。次のpushで再作成されます`);
}

const related = argAfter("--related");
if (related) {
  const postId = Number(related);
  if (!Number.isInteger(postId)) {
    console.log("✗ --related にはWP記事IDを指定");
    process.exit(1);
  }
  const base = process.env.WP_BASE_URL ?? "https://mbfasttuning.com";
  const res = await fetch(`${base}/wp-json/wp/v2/posts/${postId}?_fields=id,link,title`);
  if (!res.ok) {
    console.log(`✗ WP記事 ${postId} を取得できません: HTTP ${res.status}`);
    process.exit(1);
  }
  const post = (await res.json()) as { id: number; link: string; title: { rendered: string } };
  const list = Array.isArray(page.relatedPosts) ? (page.relatedPosts as { id?: number; title: string; url: string }[]) : [];
  if (list.some((r) => r.id === post.id)) {
    console.log(`= 既に紐付いています: ${post.title.rendered}`);
  } else {
    list.push({ id: post.id, title: post.title.rendered, url: post.link });
    await prisma.vehiclePage.update({ where: { id: page.id }, data: { relatedPosts: list } });
    console.log(`✓ ${slug}: 実績記事を追加 → ${post.title.rendered}`);
  }
}

if (!status && optIdx < 0 && !related && !args.includes("--reset-wp")) {
  console.log(`${page.slug} | status=${page.status} | JP:${page.wpPageIdJp ?? "-"} EN:${page.wpPageIdEn ?? "-"}`);
  console.log(`options: ${JSON.stringify(page.options)}`);
  console.log(`related: ${JSON.stringify(page.relatedPosts)}`);
}
