// ページ行の自動用意（seed）。scripts/vpages-seed.mts・/hq画面・価格表のWP反映フックが共用する。
// 必ず status=hold で作る＝ここから勝手に公開されることはない。

import { prisma } from "../db";
import { vehicleSlug } from "./resolve";

export async function seedVehiclePagesForBrand(brandId: string): Promise<number> {
  const vehicles = await prisma.priceVehicle.findMany({
    where: { brandId, market: "JP", page: null },
    orderBy: { displayOrder: "asc" },
  });
  if (vehicles.length === 0) return 0;
  const existing = new Set((await prisma.vehiclePage.findMany({ select: { slug: true } })).map((p) => p.slug));
  let created = 0;
  for (const v of vehicles) {
    let slug = vehicleSlug(v.carName, v.grade);
    if (!slug) continue;
    let n = 2;
    while (existing.has(slug)) slug = `${vehicleSlug(v.carName, v.grade)}-${n++}`;
    existing.add(slug);
    await prisma.vehiclePage.create({ data: { vehicleId: v.id, slug, status: "hold" } });
    created++;
  }
  return created;
}

/** 車両1台分のページ行を保証（無ければ status=hold で作成）。作成有無に関わらず行を返す */
export async function ensureVehiclePageRow(vehicleId: string) {
  const found = await prisma.vehiclePage.findUnique({ where: { vehicleId } });
  if (found) return found;
  const v = await prisma.priceVehicle.findUniqueOrThrow({ where: { id: vehicleId } });
  const existing = new Set((await prisma.vehiclePage.findMany({ select: { slug: true } })).map((p) => p.slug));
  let slug = vehicleSlug(v.carName, v.grade);
  let n = 2;
  while (existing.has(slug)) slug = `${vehicleSlug(v.carName, v.grade)}-${n++}`;
  return prisma.vehiclePage.create({ data: { vehicleId, slug, status: "hold" } });
}
