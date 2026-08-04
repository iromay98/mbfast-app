/*
 * 代理店の棚卸しレポート。**読み取り専用**。
 *
 * 用途: 「mbFAST Tuning のアカウントで今までの依頼が見えない」の原因を事実で切り分ける。
 * 見えない理由は次のどれか。推測せず全部出す。
 *   1. その代理店に紐づく記録・依頼が0件（本部が別の代理店名で登録していた）
 *   2. Dealer.pitOnly=true → ブログ投稿以外のECU系画面を見せない設計なので、依頼画面に入れない
 *   3. Dealer.ecuEnabled=false → ECUの特殊機能（施工依頼・記録）を出さない
 *   4. Dealer.status=INACTIVE → ログインできない
 *   5. ログインユーザーが1人もいない
 *
 * 実行（本番コンテナ内）: npx tsx scripts/report-dealers.mts
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

type Dealer = {
  id: string;
  name: string;
  status: string;
  pitOnly: boolean;
  ecuEnabled: boolean;
  fileFormat: string;
  createdAt: Date;
  _count: { serviceRecords: number; fileRequests: number; users: number };
};

const prisma = new PrismaClient({ adapter }) as {
  dealer: { findMany: (a: unknown) => Promise<Dealer[]> };
  $disconnect: () => Promise<void>;
};

const dealers = await prisma.dealer.findMany({
  select: {
    id: true, name: true, status: true, pitOnly: true, ecuEnabled: true,
    fileFormat: true, createdAt: true,
    _count: { select: { serviceRecords: true, fileRequests: true, users: true } },
  },
  orderBy: { createdAt: "asc" },
});

console.log("════════ 代理店 ════════");
console.log(`総数: ${dealers.length}`);
console.log("");
console.log("代理店名 | 状態 | pitOnly | ecuEnabled | 形式 | 施工記録 | 依頼 | ユーザー | 登録日 | id");
for (const d of dealers) {
  const day = d.createdAt.toLocaleDateString("sv-SE", { timeZone: "Asia/Tokyo" });
  console.log(
    `${d.name} | ${d.status} | ${d.pitOnly ? "true" : "-"} | ${d.ecuEnabled ? "true" : "false"} | ` +
      `${d.fileFormat} | ${d._count.serviceRecords} | ${d._count.fileRequests} | ${d._count.users} | ${day} | ${d.id}`,
  );
}

// ECU画面に入れない代理店を明示する（設計上の意図とデータのズレを見つけるため）
console.log("");
console.log("── ECU系画面（施工記録・依頼）に入れない代理店 ──");
const blocked = dealers.filter((d) => d.pitOnly || !d.ecuEnabled || d.status !== "ACTIVE" || d._count.users === 0);
if (blocked.length === 0) {
  console.log("  なし（全代理店がECU画面に入れます）");
} else {
  for (const d of blocked) {
    const why: string[] = [];
    if (d.pitOnly) why.push("pitOnly=true（mbPIT専用アカウント）");
    if (!d.ecuEnabled) why.push("ecuEnabled=false（ECU業務なし設定）");
    if (d.status !== "ACTIVE") why.push(`status=${d.status}`);
    if (d._count.users === 0) why.push("ログインユーザーが0人");
    console.log(`  ${d.name}: ${why.join(" / ")}（記録${d._count.serviceRecords}件・依頼${d._count.fileRequests}件）`);
  }
}

// 問い合わせのあった代理店を明示的に照合する
console.log("");
console.log("── 「mbFAST Tuning」の在否 ──");
const hits = dealers.filter((d) => /mbfast/i.test(d.name));
if (hits.length === 0) {
  console.log("  mbFAST を含む代理店はありません");
} else {
  for (const d of hits) {
    console.log(
      `  ${d.name}: status=${d.status} pitOnly=${d.pitOnly} ecuEnabled=${d.ecuEnabled} ` +
        `記録${d._count.serviceRecords}件 依頼${d._count.fileRequests}件 ユーザー${d._count.users}人 id=${d.id}`,
    );
  }
}

await prisma.$disconnect();
