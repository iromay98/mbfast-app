/*
 * 既存代理店へのmbPIT機能の一括遡り付与。
 *
 * PitStore が無い代理店（ACTIVE・pitOnly=false）を全件拾い、代理店ごとに
 * planPitProvision（衝突判定）→ provisionPitForDealer（実行）を回す。
 * ロジックは src/server/pit/provision.ts が唯一の原本（画面の「開設する」と同じもの）。
 *
 * 安全のための決めごと:
 * - **既定はドライラン**。`--commit` を付けたときだけ書き込む
 * - ドライランは代理店ごとに「採用slug／再利用するWP資産／衝突（本部判断が要るもの）」を表にする。
 *   衝突のある代理店は --commit でも**飛ばす**（自動では解決しない）
 * - slug を店名から作れない代理店（日本語店名）は `--slug=<代理店ID>:<slug>` で指定する（複数可）
 * - `--only=<代理店ID>` で1件だけに絞れる。`--no-mail` で案内メールを送らない
 * - 本体ブログ側の代理店カテゴリツリー（親355）には触れない
 *
 * 実行（本番コンテナ内）:
 *   npx tsx scripts/pit-provision-dealers.mts                       … ドライラン（一覧）
 *   npx tsx scripts/pit-provision-dealers.mts --slug=<id>:yamada-motors --commit
 */

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL が必要（本番コンテナ内で実行する前提）。");
  process.exit(2);
}

const argv = process.argv.slice(2);
const commit = argv.includes("--commit");
const noMail = argv.includes("--no-mail");
const only = argv.find((a) => a.startsWith("--only="))?.slice(7) ?? "";
const slugOverrides = new Map<string, string>();
for (const a of argv.filter((x) => x.startsWith("--slug="))) {
  const [id, slug] = a.slice(7).split(":");
  if (id && slug) slugOverrides.set(id, slug);
}

const { prisma } = await import("../src/lib/db");
const { planPitProvision, provisionPitForDealer } = await import("../src/server/pit/provision");
const { wpConfigured } = await import("../src/server/pit/wordpress");

if (!wpConfigured()) {
  console.error("WP_USER / WP_APP_PASSWORD が未設定です（カテゴリ・店舗ページの作成に必要）。");
  process.exit(2);
}

const dealers = await prisma.dealer.findMany({
  where: { pitStore: null, pitOnly: false, ...(only ? { id: only } : {}) },
  orderBy: { createdAt: "asc" },
  select: { id: true, name: true, status: true, email: true },
});

console.log(commit ? "== 既存代理店へのmbPIT付与（書き込み） ==" : "== 既存代理店へのmbPIT付与（ドライラン・書き込みなし） ==");
console.log(`対象: PitStore未作成の代理店 ${dealers.length} 件`);
console.log("");

let ready = 0;
let blocked = 0;
let created = 0;
let failed = 0;
for (const d of dealers) {
  const slug = slugOverrides.get(d.id);
  const plan = await planPitProvision(d.id, { slug });
  const tag = plan.status === "ready" ? "READY  " : plan.status === "exists" ? "EXISTS " : "BLOCKED";
  console.log(`[${tag}] ${d.name}  id=${d.id}  status=${d.status}  slug=${plan.slug || "(未定)"}  mail=${d.email ?? "-"}`);
  for (const n of plan.notes) console.log(`           note: ${n}`);
  for (const i of plan.issues) console.log(`           !!  : ${i}`);
  if (d.status !== "ACTIVE") console.log("           note: 無効な代理店です（開設は可能ですが要確認）");

  if (plan.status === "ready") ready++;
  if (plan.status === "blocked") blocked++;
  if (!commit || plan.status !== "ready") continue;

  const r = await provisionPitForDealer(d.id, { slug, sendMail: !noMail });
  if (r.ok) {
    created++;
    console.log(`           → 開設: /mbpit/${r.slug}/  cat=${r.categoryId}  page=${r.pageId}  mail=${r.mailSent ? "送信" : "未送信"}`);
  } else {
    failed++;
    console.log(`           → 失敗: ${r.error ?? r.issues.join(" / ")}`);
  }
  for (const n of r.notes) console.log(`           note: ${n}`);
  await new Promise((res) => setTimeout(res, 400)); // WPへの連続書き込みを緩める
}

console.log("");
console.log(`集計: 開設可能 ${ready} / 要判断 ${blocked}${commit ? ` / 開設 ${created} / 失敗 ${failed}` : ""}`);
if (!commit && ready > 0) console.log("→ 内容を確認のうえ、--commit を付けて再実行すると開設します。");
if (blocked > 0) console.log("→ 要判断の代理店は --slug=<代理店ID>:<slug> で別slugを指定するか、WP側のカテゴリslugを整理してから再実行してください。");

await prisma.$disconnect();
