/*
 * mbPIT の利用状況レポート（読み取り専用・DBは一切変更しない）。
 *
 *   npm run report:pit-usage
 *
 * 店舗ごとに「車両登録／証明書（下書き・発行済み・無効）／ブログ投稿」の件数を出す。
 * 「本店だけ使っていて加盟店が手を付けていない」といった状態を数で確認するため。
 * 個人情報は出さない（件数と最終日時のみ）。
 */
import { prisma } from "../src/lib/db";

const stores = await prisma.pitStore.findMany({
  orderBy: [{ active: "desc" }, { displayName: "asc" }],
  select: {
    id: true,
    displayName: true,
    slug: true,
    active: true,
    facilityType: true,
    dealer: { select: { name: true } },
  },
});

const ymd = (d: Date | null) => (d ? d.toLocaleDateString("ja-JP", { timeZone: "Asia/Tokyo" }) : "—");

let totalIssued = 0;
let totalDraft = 0;
let storesWithIssued = 0;

for (const s of stores) {
  const [certs, latestCert, vehicles, posts, latestPost] = await Promise.all([
    prisma.pitCertificate.groupBy({
      by: ["status"],
      where: { storeId: s.id },
      _count: { _all: true },
    }),
    prisma.pitCertificate.findFirst({
      where: { storeId: s.id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    // 車両は顧客経由で数える（店舗間で共有される車両を二重に数えない）
    prisma.pitVehicleCustomer.count({ where: { endedOn: null, customer: { storeId: s.id } } }),
    prisma.pitPost.groupBy({ by: ["status"], where: { storeId: s.id }, _count: { _all: true } }),
    prisma.pitPost.findFirst({
      where: { storeId: s.id },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
  ]);

  const n = (rows: { status: string; _count: { _all: number } }[], st: string) =>
    rows.find((r) => r.status === st)?._count._all ?? 0;
  const issued = n(certs, "issued");
  const draft = n(certs, "draft") + n(certs, "failed");
  const voided = n(certs, "voided");
  totalIssued += issued;
  totalDraft += draft;
  if (issued > 0) storesWithIssued++;

  const owner = s.dealer?.name ?? "本店直営";
  console.log(
    `${s.active ? "●" : "○"} ${s.displayName}（${owner} / ${s.slug}）${s.active ? "" : " ※停止中"}`,
  );
  console.log(
    `    車両 ${String(vehicles).padStart(3)}台   証明書: 発行 ${String(issued).padStart(3)} / 未発行 ${String(draft).padStart(3)} / 無効 ${String(voided).padStart(3)}   最終作成 ${ymd(latestCert?.createdAt ?? null)}`,
  );
  console.log(
    `    ブログ: 公開 ${String(n(posts, "published")).padStart(3)} / 保留 ${String(n(posts, "held")).padStart(3)} / 失敗 ${String(n(posts, "failed")).padStart(3)}   最終投稿 ${ymd(latestPost?.createdAt ?? null)}`,
  );
}

console.log("");
console.log(
  `店舗 ${stores.length}件中 ${storesWithIssued}件が証明書を発行済み（発行 計${totalIssued}件 / 未発行 計${totalDraft}件）`,
);
if (totalDraft > 0) {
  console.log("未発行が残っている店舗は、作ったのにお客様へ渡せていない状態です。");
}
await prisma.$disconnect();
