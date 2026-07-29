/*
 * 顧客・車両の参照（店舗スコープの唯一の入口）。
 *
 * 店舗間で顧客情報が見えてはならない。その保証を画面やアクションに散らすと必ず穴が空くため、
 * 「storeId を必ず引数で取り、where に必ず含める」関数をここに集約する。
 * 画面・サーバーアクションは prisma.pitCustomer / pitVehicle を直接触らずこの関数群を使う。
 * （scripts/check-store-isolation.mts が実DBに対して越境できないことを検証する）
 *
 * 車両は必ず自店の顧客に紐づけて登録する。紐づけの無い車両は自店から辿れない
 * ＝他店の顧客の車両が一覧に混ざらない。
 */
import { prisma } from "@/lib/db";

export type StoreCustomerRow = {
  id: string;
  name: string;
  kana: string;
  tel: string;
  email: string;
  address: string;
  vehicleName: string;
  inspectionExpiry: Date | null;
  note: string;
};

const CUSTOMER_SELECT = {
  id: true,
  name: true,
  kana: true,
  tel: true,
  email: true,
  address: true,
  vehicleName: true,
  inspectionExpiry: true,
  note: true,
} as const;

/** 自店の顧客一覧（車検の近い順） */
export async function listStoreCustomers(storeId: string): Promise<StoreCustomerRow[]> {
  return prisma.pitCustomer.findMany({
    where: { storeId },
    orderBy: [{ inspectionExpiry: { sort: "asc", nulls: "last" } }, { name: "asc" }],
    select: CUSTOMER_SELECT,
  });
}

/** 自店の顧客1件。他店のIDを渡しても null（存在を漏らさない） */
export async function getStoreCustomer(storeId: string, customerId: string): Promise<StoreCustomerRow | null> {
  return prisma.pitCustomer.findFirst({ where: { id: customerId, storeId }, select: CUSTOMER_SELECT });
}

/** 車検が近い自店の顧客（ホーム画面のお知らせ用） */
export async function listUpcomingInspections(
  storeId: string,
  withinDays = 60,
  take = 10,
): Promise<StoreCustomerRow[]> {
  const until = new Date(Date.now() + withinDays * 86_400_000);
  return prisma.pitCustomer.findMany({
    where: { storeId, inspectionExpiry: { not: null, lte: until } },
    orderBy: { inspectionExpiry: "asc" },
    take,
    select: CUSTOMER_SELECT,
  });
}

export type StoreVehicleRow = {
  vehicleId: string;
  customerId: string;
  customerName: string;
  vehicleName: string;
  maker: string;
  modelCode: string;
  chassisLast3: string;
  firstRegisteredOn: Date | null;
  inspectionExpiry: Date | null;
  /** 非公開項目が暗号化済みで入っているか（値は返さない） */
  hasVin: boolean;
  hasRegNumber: boolean;
};

/** 自店の顧客に紐づく車両（現所有＝endedOn が null のもの） */
export async function listStoreVehicles(storeId: string): Promise<StoreVehicleRow[]> {
  const links = await prisma.pitVehicleCustomer.findMany({
    where: { endedOn: null, customer: { storeId } },
    orderBy: { startedOn: "desc" },
    select: {
      customerId: true,
      customer: { select: { name: true } },
      vehicle: {
        select: {
          id: true,
          vehicleName: true,
          maker: true,
          modelCode: true,
          chassisLast3: true,
          firstRegisteredOn: true,
          inspectionExpiry: true,
          vinEnc: true,
          regNumberEnc: true,
        },
      },
    },
  });
  return links.map((l) => ({
    vehicleId: l.vehicle.id,
    customerId: l.customerId,
    customerName: l.customer.name,
    vehicleName: l.vehicle.vehicleName ?? "",
    maker: l.vehicle.maker ?? "",
    modelCode: l.vehicle.modelCode ?? "",
    chassisLast3: l.vehicle.chassisLast3 ?? "",
    firstRegisteredOn: l.vehicle.firstRegisteredOn,
    inspectionExpiry: l.vehicle.inspectionExpiry,
    hasVin: !!l.vehicle.vinEnc,
    hasRegNumber: !!l.vehicle.regNumberEnc,
  }));
}

/**
 * 自店から辿れる車両か（証明書作成の入口で必ず通す）。
 * 自店の顧客に紐づいていない車両は「見つからない」扱いにする。
 */
export async function getStoreVehicle(storeId: string, vehicleId: string): Promise<StoreVehicleRow | null> {
  const rows = await listStoreVehicles(storeId);
  return rows.find((r) => r.vehicleId === vehicleId) ?? null;
}

/** 車両と自店顧客を紐づける（同じ組み合わせが現行なら何もしない） */
export async function linkVehicleToCustomer(opts: {
  storeId: string;
  vehicleId: string;
  customerId: string;
}): Promise<{ ok?: true; error?: string }> {
  const customer = await prisma.pitCustomer.findFirst({
    where: { id: opts.customerId, storeId: opts.storeId },
    select: { id: true },
  });
  if (!customer) return { error: "顧客が見つかりません" };

  const current = await prisma.pitVehicleCustomer.findFirst({
    where: { vehicleId: opts.vehicleId, customerId: opts.customerId, endedOn: null },
    select: { id: true },
  });
  if (current) return { ok: true };

  await prisma.pitVehicleCustomer.create({
    data: { vehicleId: opts.vehicleId, customerId: opts.customerId },
  });
  // 顧客カルテ側にも車両参照を残す（既存画面の「車両」表示と検証書作成の導線用）
  await prisma.pitCustomer.update({ where: { id: opts.customerId }, data: { vehicleId: opts.vehicleId } });
  return { ok: true };
}

/**
 * 自店の紐づけを終了する（登録間違いの訂正・所有権移転の記録）。
 * 車両そのものは消さない（履歴は車に紐づくため、消すと他店の証明書が孤立する）。
 */
export async function endStoreVehicleLink(opts: {
  storeId: string;
  vehicleId: string;
  customerId: string;
}): Promise<{ ok?: true; error?: string }> {
  const link = await prisma.pitVehicleCustomer.findFirst({
    where: {
      vehicleId: opts.vehicleId,
      customerId: opts.customerId,
      endedOn: null,
      customer: { storeId: opts.storeId },
    },
    select: { id: true },
  });
  if (!link) return { error: "紐づけが見つかりません" };
  await prisma.pitVehicleCustomer.update({ where: { id: link.id }, data: { endedOn: new Date() } });
  await prisma.pitCustomer.updateMany({
    where: { id: opts.customerId, storeId: opts.storeId, vehicleId: opts.vehicleId },
    data: { vehicleId: null },
  });
  return { ok: true };
}
