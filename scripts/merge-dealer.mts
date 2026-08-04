/*
 * 代理店を統合する（同じ店舗が2レコードに分かれてしまった場合の後始末）。
 *
 * 発端: 本店施工が代理店「本店」に37件入っており、mbPIT加盟店として別に作られた
 * 「mbFAST Tuning」からは何も見えなかった。同一店舗なので1つに寄せる。
 *
 * 何を移すか: Dealer が持つ関連の**全部**（漏らすと片方に取り残される）。
 *   users / serviceRecords / fileRequests / reads / catalogDownloads
 * PitStore は dealerId が一意なので**移さない**。両方が持っていたら統合を中止する
 * （どちらのブログ店舗を残すかは機械的に決められない）。
 *
 * 安全のための決めごと:
 * - **既定はドライラン**。`--commit` を付けたときだけ書き込む
 * - 移動元は空にするだけで**削除しない**（監査のため。あとで /hq から停止すればよい）
 * - AnnouncementRead は (announcementId, dealerId) が主キーなので、
 *   移動先に同じ告知の既読があれば**移さず捨てる**（既読は既読なので情報は失わない）
 * - 1トランザクションで実行（途中で止まって半分だけ移った状態を作らない）
 * - `--allow-ecu` を付けたときだけ、移動先の pitOnly を false にする
 *   （ECU系画面＝Cal/HW/SW等の技術情報を開放する変更なので、明示させる）
 *
 * 実行（本番コンテナ内）:
 *   npx tsx scripts/merge-dealer.mts --from=<代理店id> --into=<代理店id>
 *   npx tsx scripts/merge-dealer.mts --from=... --into=... --allow-ecu --commit
 */

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL が必要（本番コンテナ内で実行する前提）。");
  process.exit(2);
}

const argv = process.argv.slice(2);
const commit = argv.includes("--commit");
const allowEcu = argv.includes("--allow-ecu");
const arg = (k: string): string => {
  const hit = argv.find((a) => a.startsWith(`--${k}=`));
  return hit ? hit.slice(k.length + 3) : "";
};
const fromId = arg("from").trim();
const intoId = arg("into").trim();

if (!fromId || !intoId) {
  console.error("使い方: --from=<移動元の代理店id> --into=<移動先の代理店id> [--allow-ecu] [--commit]");
  process.exit(2);
}
if (fromId === intoId) {
  console.error("移動元と移動先が同じです。");
  process.exit(2);
}

const { PrismaClient } = (await import("../src/generated/prisma/client")) as {
  PrismaClient: new (o: unknown) => unknown;
};
const { PrismaPg } = (await import("@prisma/adapter-pg")) as { PrismaPg: new (s: string) => unknown };

type Dealer = {
  id: string;
  name: string;
  status: string;
  pitOnly: boolean;
  ecuEnabled: boolean;
  _count: {
    users: number;
    serviceRecords: number;
    fileRequests: number;
    reads: number;
    catalogDownloads: number;
  };
  pitStore: { id: string; displayName: string; slug: string } | null;
};

const adapter = new PrismaPg(process.env.DATABASE_URL);
const prisma = new PrismaClient({ adapter }) as {
  dealer: {
    findUnique: (a: unknown) => Promise<Dealer | null>;
    update: (a: unknown) => Promise<unknown>;
  };
  user: { updateMany: (a: unknown) => Promise<{ count: number }> };
  serviceRecord: { updateMany: (a: unknown) => Promise<{ count: number }> };
  fileRequest: { updateMany: (a: unknown) => Promise<{ count: number }> };
  catalogDownloadLog: { updateMany: (a: unknown) => Promise<{ count: number }> };
  announcementRead: {
    findMany: (a: unknown) => Promise<{ announcementId: string }[]>;
    updateMany: (a: unknown) => Promise<{ count: number }>;
    deleteMany: (a: unknown) => Promise<{ count: number }>;
  };
  $transaction: (ops: unknown[]) => Promise<unknown[]>;
  $disconnect: () => Promise<void>;
};

const sel = {
  id: true, name: true, status: true, pitOnly: true, ecuEnabled: true,
  _count: {
    select: {
      users: true, serviceRecords: true, fileRequests: true,
      reads: true, catalogDownloads: true,
    },
  },
  pitStore: { select: { id: true, displayName: true, slug: true } },
};

const [from, into] = await Promise.all([
  prisma.dealer.findUnique({ where: { id: fromId }, select: sel }),
  prisma.dealer.findUnique({ where: { id: intoId }, select: sel }),
]);
if (!from) {
  console.error(`移動元の代理店 ${fromId} が見つかりません。`);
  process.exit(1);
}
if (!into) {
  console.error(`移動先の代理店 ${intoId} が見つかりません。`);
  process.exit(1);
}

const show = (d: Dealer, label: string) => {
  console.log(`${label}: ${d.name}（${d.status} / pitOnly=${d.pitOnly} / ecuEnabled=${d.ecuEnabled}）`);
  console.log(
    `  ユーザー${d._count.users} 施工記録${d._count.serviceRecords} 依頼${d._count.fileRequests} ` +
      `既読${d._count.reads} カタログDL${d._count.catalogDownloads}` +
      (d.pitStore ? ` / mbPIT店舗「${d.pitStore.displayName}」(${d.pitStore.slug})` : " / mbPIT店舗なし"),
  );
};

console.log(commit ? "== 代理店の統合（書き込み） ==" : "== 代理店の統合（ドライラン・書き込みなし） ==");
show(from, "移動元");
show(into, "移動先");
console.log("");

// mbPIT店舗は dealerId が一意。両方が持っていたら機械的に決められないので中止する
if (from.pitStore && into.pitStore) {
  console.error(
    `両方にmbPIT店舗が紐づいています（移動元「${from.pitStore.displayName}」/ 移動先「${into.pitStore.displayName}」）。` +
      "どちらを残すか決めてから、片方の紐付けを外して再実行してください。",
  );
  await prisma.$disconnect();
  process.exit(1);
}
if (from.pitStore) {
  console.log(
    `※ 移動元にmbPIT店舗「${from.pitStore.displayName}」が紐づいています。` +
      "この統合では**移しません**（/hq/pit で付け替えてください）。",
  );
}

// 既読は主キー衝突するので、移動先に既にある告知の分は捨てる
const [fromReads, intoReads] = await Promise.all([
  prisma.announcementRead.findMany({ where: { dealerId: fromId }, select: { announcementId: true } }),
  prisma.announcementRead.findMany({ where: { dealerId: intoId }, select: { announcementId: true } }),
]);
const intoSet = new Set(intoReads.map((r) => r.announcementId));
const dupReadIds = fromReads.map((r) => r.announcementId).filter((a) => intoSet.has(a));
const moveReadIds = fromReads.map((r) => r.announcementId).filter((a) => !intoSet.has(a));

console.log("── 移す内容 ──");
console.log(`  ユーザー      ${from._count.users}`);
console.log(`  施工記録      ${from._count.serviceRecords}`);
console.log(`  依頼          ${from._count.fileRequests}`);
console.log(`  カタログDL    ${from._count.catalogDownloads}`);
console.log(`  既読          ${moveReadIds.length}（重複して捨てる分: ${dupReadIds.length}）`);
if (into.pitOnly) {
  console.log("");
  if (allowEcu) {
    console.log("  移動先の pitOnly を false にします（ECU系画面を開放）。");
  } else {
    console.log(
      "  ※ 移動先は pitOnly=true（mbPIT専用）なので、移してもECU系画面には入れません。" +
        "\n     開放するには --allow-ecu を付けて実行してください（Cal/HW/SW等の技術情報が見えるようになります）。",
    );
  }
}

if (!commit) {
  console.log("");
  console.log("書き込むには --commit を付けて実行してください。");
  await prisma.$disconnect();
  process.exit(0);
}

// 1トランザクションで。途中で失敗したら何も起きていない状態に戻る
const ops = [
  prisma.user.updateMany({ where: { dealerId: fromId }, data: { dealerId: intoId } }),
  prisma.serviceRecord.updateMany({ where: { dealerId: fromId }, data: { dealerId: intoId } }),
  prisma.fileRequest.updateMany({ where: { dealerId: fromId }, data: { dealerId: intoId } }),
  prisma.catalogDownloadLog.updateMany({ where: { dealerId: fromId }, data: { dealerId: intoId } }),
  // 既読: 重複分を捨ててから残りを移す（順番が逆だと主キー衝突で落ちる）
  prisma.announcementRead.deleteMany({
    where: { dealerId: fromId, announcementId: { in: dupReadIds } },
  }),
  prisma.announcementRead.updateMany({ where: { dealerId: fromId }, data: { dealerId: intoId } }),
  ...(allowEcu && into.pitOnly
    ? [prisma.dealer.update({ where: { id: intoId }, data: { pitOnly: false } })]
    : []),
];
const res = (await prisma.$transaction(ops)) as { count?: number }[];
console.log("");
console.log("── 結果 ──");
console.log(`  ユーザー      ${res[0]?.count ?? 0}`);
console.log(`  施工記録      ${res[1]?.count ?? 0}`);
console.log(`  依頼          ${res[2]?.count ?? 0}`);
console.log(`  カタログDL    ${res[3]?.count ?? 0}`);
console.log(`  既読(破棄)    ${res[4]?.count ?? 0}`);
console.log(`  既読(移動)    ${res[5]?.count ?? 0}`);
if (allowEcu && into.pitOnly) console.log("  移動先の pitOnly を false にしました");
console.log("");
console.log(`移動元「${from.name}」は空になりましたが削除していません（監査のため）。`);
console.log("以後の本部代行アップロードでは、移動先の代理店を選んでください。");

await prisma.$disconnect();
