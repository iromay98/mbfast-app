import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL が未設定です");

const adapter = new PrismaPg(connectionString);
const prisma = new PrismaClient({ adapter });

// 開発用の共通初期パスワード（README に記載）。本番では使わないこと。
const DEFAULT_PASSWORD = "password123";

async function main() {
  console.log("🌱 シード開始...");
  const passwordHash = await bcrypt.hash(DEFAULT_PASSWORD, 10);

  // 依存関係の逆順で全削除（再実行を冪等にする）
  await prisma.requestEvent.deleteMany();
  await prisma.announcementRead.deleteMany();
  await prisma.announcement.deleteMany();
  await prisma.fileRequest.deleteMany();
  await prisma.serviceRecord.deleteMany();
  await prisma.user.deleteMany();
  await prisma.dealer.deleteMany();

  // ── 本店管理者 ──────────────────────────────
  const admin = await prisma.user.create({
    data: {
      email: "admin@mbfast.jp",
      passwordHash,
      role: "HQ_ADMIN",
      name: "本店管理者",
    },
  });

  // ── 代理店 3 店 + 各ログインユーザー ─────────
  const dealersSeed = [
    {
      name: "mbFAST 東京ベース",
      address: "東京都世田谷区桜新町1-2-3",
      lat: 35.6271,
      lng: 139.6498,
      phone: "03-1234-5678",
      email: "tokyo@mbfast.jp",
      autotunerToolId: "AT-SLAVE-0001",
      userEmail: "tokyo@mbfast.jp",
      userName: "東京ベース 田中",
    },
    {
      name: "mbFAST 大阪ガレージ",
      address: "大阪府大阪市西区南堀江2-4-6",
      lat: 34.6709,
      lng: 135.4929,
      phone: "06-2345-6789",
      email: "osaka@mbfast.jp",
      autotunerToolId: "AT-SLAVE-0002",
      userEmail: "osaka@mbfast.jp",
      userName: "大阪ガレージ 鈴木",
    },
    {
      name: "mbFAST 福岡ファクトリー",
      address: "福岡県福岡市博多区博多駅前3-5-7",
      lat: 33.5898,
      lng: 130.4207,
      phone: "092-3456-7890",
      email: "fukuoka@mbfast.jp",
      autotunerToolId: "AT-SLAVE-0003",
      userEmail: "fukuoka@mbfast.jp",
      userName: "福岡ファクトリー 佐藤",
    },
  ];

  const dealers = [];
  for (const d of dealersSeed) {
    const dealer = await prisma.dealer.create({
      data: {
        name: d.name,
        address: d.address,
        lat: d.lat,
        lng: d.lng,
        phone: d.phone,
        email: d.email,
        status: "ACTIVE",
        autotunerToolId: d.autotunerToolId,
      },
    });
    const user = await prisma.user.create({
      data: {
        email: d.userEmail,
        passwordHash,
        role: "DEALER",
        name: d.userName,
        dealerId: dealer.id,
      },
    });
    dealers.push({ dealer, user });
  }

  // ── 施工記録 ────────────────────────────────
  const recordsSeed = [
    {
      i: 0,
      vin: "WAUZZZ8V1JA123456",
      carMaker: "Audi",
      carModel: "S3 8V",
      carYear: 2018,
      ecuType: "Bosch MED17.1.1",
      tcuType: "DQ250",
      softwareNumber: "8V0906259K",
      workType: "TUNING" as const,
      appliedMap: "Stage1 98RON",
      note: "純正→Stage1。ブースト立ち上がり改善。",
      daysAgo: 3,
    },
    {
      i: 0,
      vin: "WVWZZZ1KZAW000111",
      carMaker: "VW",
      carModel: "Golf6 GTI",
      carYear: 2012,
      ecuType: "Bosch MED17.5.5",
      tcuType: null,
      softwareNumber: "5K0907115AB",
      workType: "POPS_AND_BANGS" as const,
      appliedMap: "PnB-mild",
      note: "バブリング(マイルド)。",
      daysAgo: 10,
    },
    {
      i: 1,
      vin: "JF1VAB000H0000222",
      carMaker: "Subaru",
      carModel: "WRX STI VAB",
      carYear: 2017,
      ecuType: "Hitachi SH72543",
      tcuType: null,
      softwareNumber: "22765AM120",
      workType: "TUNING" as const,
      appliedMap: "Stage1+",
      note: "ノックフィードバック確認済み。",
      daysAgo: 1,
    },
    {
      i: 2,
      vin: "WBA8E9100GK000333",
      carMaker: "BMW",
      carModel: "320i F30",
      carYear: 2016,
      ecuType: "Bosch MEVD17.2.4",
      tcuType: "ZF8HP",
      softwareNumber: "8665600",
      workType: "TCU" as const,
      appliedMap: "TCU-shift-opt",
      note: "TCU 変速最適化。",
      daysAgo: 5,
    },
  ];

  for (const r of recordsSeed) {
    const { dealer, user } = dealers[r.i];
    const workedAt = new Date();
    workedAt.setDate(workedAt.getDate() - r.daysAgo);
    await prisma.serviceRecord.create({
      data: {
        dealerId: dealer.id,
        vin: r.vin,
        carMaker: r.carMaker,
        carModel: r.carModel,
        carYear: r.carYear,
        ecuType: r.ecuType,
        tcuType: r.tcuType,
        softwareNumber: r.softwareNumber,
        workType: r.workType,
        appliedMap: r.appliedMap,
        workedAt,
        note: r.note,
        createdById: user.id,
      },
    });
  }

  // ── 作業依頼（ステータス別） ────────────────
  // 受付済み
  const req1 = await prisma.fileRequest.create({
    data: {
      dealerId: dealers[0].dealer.id,
      title: "Audi RS3 8V Stage1 依頼",
      carInfo: "Audi RS3 8V / 2019 / DAZA",
      vin: "WUAZZZF50KA000444",
      ecuType: "Bosch MG1",
      requestNote: "98RON Stage1 希望。スレーブ読み出し添付。",
      status: "RECEIVED",
    },
  });
  await prisma.requestEvent.create({
    data: { requestId: req1.id, status: "RECEIVED", actorId: dealers[0].user.id, comment: "依頼作成" },
  });

  // 作業中
  const req2 = await prisma.fileRequest.create({
    data: {
      dealerId: dealers[1].dealer.id,
      title: "Golf7 R TCU 依頼",
      carInfo: "VW Golf7 R / 2017 / DQ250",
      vin: "WVWZZZAUZHW000555",
      ecuType: "Temic DQ250",
      requestNote: "クラッチ容量UPに合わせTCU調整希望。",
      status: "IN_PROGRESS",
      hqNote: "ベースマップ作成中。",
    },
  });
  await prisma.requestEvent.createMany({
    data: [
      { requestId: req2.id, status: "RECEIVED", actorId: dealers[1].user.id, comment: "依頼作成" },
      { requestId: req2.id, status: "IN_PROGRESS", actorId: admin.id, comment: "本店で作業開始" },
    ],
  });

  // 納品済み
  const req3 = await prisma.fileRequest.create({
    data: {
      dealerId: dealers[2].dealer.id,
      title: "BMW M2 Stage2 依頼",
      carInfo: "BMW M2 Competition / 2020 / S55",
      vin: "WBS2U9100L7000666",
      ecuType: "Bosch MG1",
      requestNote: "ダウンパイプ装着済み。Stage2希望。",
      status: "DELIVERED",
      hqNote: "Stage2 マップ納品。ログ返送お願いします。",
    },
  });
  await prisma.requestEvent.createMany({
    data: [
      { requestId: req3.id, status: "RECEIVED", actorId: dealers[2].user.id, comment: "依頼作成" },
      { requestId: req3.id, status: "IN_PROGRESS", actorId: admin.id },
      { requestId: req3.id, status: "DELIVERED", actorId: admin.id, comment: "成果ファイル納品" },
    ],
  });

  // ── お知らせ ────────────────────────────────
  await prisma.announcement.createMany({
    data: [
      {
        title: "【重要】年末年始の本店受付スケジュール",
        body: "12/29〜1/4 は本店の依頼受付を停止します。\n\n緊急の場合は LINE までご連絡ください。",
        category: "NOTICE",
        publishedById: admin.id,
      },
      {
        title: "DQ381 ミッション学習リセット手順の更新",
        body: "## 手順\n1. IGN ON\n2. 診断機接続\n3. 適応値リセット\n\n詳細は技術資料を参照。",
        category: "TECH",
        publishedById: admin.id,
      },
      {
        title: "2026年4月 施工価格改定のお知らせ",
        body: "原価高騰に伴い、Stage1 の卸価格を改定します。\n\n新価格は別紙参照。",
        category: "PRICING",
        publishedById: admin.id,
      },
    ],
  });

  console.log("✅ シード完了");
  console.log("──────────────────────────────────────");
  console.log("ログイン情報（共通パスワード: " + DEFAULT_PASSWORD + "）");
  console.log("  本店管理者 : admin@mbfast.jp");
  console.log("  代理店(東京): tokyo@mbfast.jp");
  console.log("  代理店(大阪): osaka@mbfast.jp");
  console.log("  代理店(福岡): fukuoka@mbfast.jp");
  console.log("──────────────────────────────────────");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
