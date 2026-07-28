"use server";

/*
 * mbPIT 加盟店の顧客カルテ。自店の顧客のみ操作できる（サーバー側で dealerId → 店舗解決）。
 * 個人情報のため本部画面には出さない設計。
 */
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireDealer } from "@/lib/authz";

const PATH = "/dealer/pit/customers";

async function ownStore(): Promise<{ storeId?: string; error?: string }> {
  const user = await requireDealer();
  const store = await prisma.pitStore.findUnique({
    where: { dealerId: user.dealerId },
    select: { id: true },
  });
  if (!store) return { error: "この店舗はmbPITに登録されていません" };
  return { storeId: store.id };
}

export type CustomerInput = {
  id?: string;
  name: string;
  kana: string;
  tel: string;
  vehicleName: string;
  inspectionExpiry: string; // "" | YYYY-MM-DD
  note: string;
};

export async function upsertPitCustomer(input: CustomerInput): Promise<{ ok?: true; error?: string }> {
  const own = await ownStore();
  if (!own.storeId) return { error: own.error };

  const name = input.name.trim();
  if (!name) return { error: "お名前を入力してください" };
  if (name.length > 60) return { error: "お名前が長すぎます" };
  if (input.tel && !/^[0-9+\-]+$/.test(input.tel.trim())) {
    return { error: "電話番号は数字・ハイフン・+ のみ使えます" };
  }
  if (input.inspectionExpiry && !/^\d{4}-\d{2}-\d{2}$/.test(input.inspectionExpiry)) {
    return { error: "車検満了日の形式が正しくありません" };
  }
  if (input.note.length > 2000) return { error: "メモは2000文字以内にしてください" };

  const data = {
    name,
    kana: input.kana.trim(),
    tel: input.tel.trim(),
    vehicleName: input.vehicleName.trim(),
    inspectionExpiry: input.inspectionExpiry
      ? new Date(`${input.inspectionExpiry}T00:00:00+09:00`)
      : null,
    note: input.note.trim(),
  };

  if (input.id) {
    // 自店の顧客であることを必ず検証（他店IDを渡されても更新できない）
    const existing = await prisma.pitCustomer.findUnique({
      where: { id: input.id },
      select: { storeId: true },
    });
    if (!existing || existing.storeId !== own.storeId) return { error: "顧客が見つかりません" };
    await prisma.pitCustomer.update({ where: { id: input.id }, data });
  } else {
    await prisma.pitCustomer.create({ data: { ...data, storeId: own.storeId } });
  }
  revalidatePath(PATH);
  return { ok: true };
}

export async function deletePitCustomer(id: string): Promise<{ ok?: true; error?: string }> {
  const own = await ownStore();
  if (!own.storeId) return { error: own.error };
  const existing = await prisma.pitCustomer.findUnique({ where: { id }, select: { storeId: true } });
  if (!existing || existing.storeId !== own.storeId) return { error: "顧客が見つかりません" };
  await prisma.pitCustomer.delete({ where: { id } });
  revalidatePath(PATH);
  return { ok: true };
}
