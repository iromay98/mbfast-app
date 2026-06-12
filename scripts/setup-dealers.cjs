const { PrismaClient } = require("../src/generated/prisma");
const { PrismaPg } = require("@prisma/adapter-pg");
const bcrypt = require("bcryptjs");
const p = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

const NEW = [
  { name: "Charism Garage", address: "北海道", email: "charism@mbfast.jp" },
  { name: "Firmament", address: "宮城県", email: "firmament@mbfast.jp" },
  { name: "On's", address: "新潟県", email: "ons@mbfast.jp" },
  { name: "SFIDA", address: "長野県", email: "sfida@mbfast.jp" },
  { name: "WorldMotorHattori", address: "大阪府", email: "worldmotorhattori@mbfast.jp" },
  { name: "プレジャー", address: "福岡県", email: "pleasure@mbfast.jp" },
  { name: "Glanzcoat", address: "鹿児島県", email: "glanzcoat@mbfast.jp" },
  { name: "BoostCraft", address: "栃木県", email: "boostcraft@mbfast.jp", note: "OEM" },
];

(async () => {
  // 1. 既存の仮代理店を「テスト店」へ統合
  const existing = await p.dealer.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, _count: { select: { serviceRecords: true } } },
  });
  if (!existing.some((d) => d.name === "テスト店") && existing.length > 0) {
    const survivor = existing.slice().sort((a, b) => b._count.serviceRecords - a._count.serviceRecords)[0];
    const others = existing.filter((d) => d.id !== survivor.id);
    for (const o of others) {
      await p.serviceRecord.updateMany({ where: { dealerId: o.id }, data: { dealerId: survivor.id } });
      await p.fileRequest.updateMany({ where: { dealerId: o.id }, data: { dealerId: survivor.id } });
      await p.catalogDownloadLog.updateMany({ where: { dealerId: o.id }, data: { dealerId: survivor.id } });
      await p.user.updateMany({ where: { dealerId: o.id }, data: { dealerId: survivor.id } });
      const reads = await p.announcementRead.findMany({ where: { dealerId: o.id } });
      for (const r of reads) {
        const key = { announcementId_dealerId: { announcementId: r.announcementId, dealerId: survivor.id } };
        const dup = await p.announcementRead.findUnique({ where: key });
        const oldKey = { announcementId_dealerId: { announcementId: r.announcementId, dealerId: o.id } };
        if (dup) await p.announcementRead.delete({ where: oldKey });
        else await p.announcementRead.update({ where: oldKey, data: { dealerId: survivor.id } });
      }
      await p.dealer.delete({ where: { id: o.id } });
    }
    await p.dealer.update({
      where: { id: survivor.id },
      data: { name: "テスト店", address: null, note: "テスト用に統合した仮代理店" },
    });
    console.log("統合: テスト店 = " + survivor.id + "（旧 " + existing.length + " 店を統合）");
  } else {
    console.log("統合スキップ（テスト店が既に存在 or 対象なし）");
  }

  // 2. 本番代理店7店を作成（各ログインアカウント付き・初期PW password123）
  const hash = await bcrypt.hash("password123", 10);
  for (const d of NEW) {
    const exU = await p.user.findUnique({ where: { email: d.email } });
    if (exU) {
      console.log("スキップ(既存): " + d.email);
      continue;
    }
    const dealer = await p.dealer.create({
      data: { name: d.name, address: d.address, status: "ACTIVE", note: d.note ?? null },
    });
    await p.user.create({
      data: { email: d.email, name: d.name, passwordHash: hash, role: "DEALER", dealerId: dealer.id },
    });
    console.log("作成: " + d.name + " (" + d.address + ") / " + d.email + " / password123");
  }
})()
  .catch((e) => {
    console.error("ERROR:", e);
    process.exit(1);
  })
  .finally(() => p.$disconnect());
