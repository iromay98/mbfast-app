"use server";

/*
 * mbPIT 加盟店の顧客カルテ。自店の顧客のみ操作できる（店舗はセッションから解決）。
 * 個人情報のため本部画面には出さない設計。
 * 参照系は src/server/pit/customer-repo.ts（storeId を必ず where に含める層）を通す。
 */
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { ownPitStore } from "@/server/pit/own-store";
import { getStoreCustomer } from "@/server/pit/customer-repo";

const PATH = "/dealer/pit/customers";

export type CustomerInput = {
  id?: string;
  name: string;
  kana: string;
  tel: string;
  vehicleName: string;
  inspectionExpiry: string; // "" | YYYY-MM-DD
  note: string;
  /** 法定記録簿の依頼者住所（非公開）。証明書機能で使う */
  address: string;
  email: string;
};

export async function upsertPitCustomer(input: CustomerInput): Promise<{ ok?: true; error?: string }> {
  const own = await ownPitStore();
  if (!own.store) return { error: own.error };

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
  if (input.address.length > 200) return { error: "住所が長すぎます" };

  const data = {
    name,
    kana: input.kana.trim(),
    tel: input.tel.trim(),
    vehicleName: input.vehicleName.trim(),
    inspectionExpiry: input.inspectionExpiry
      ? new Date(`${input.inspectionExpiry}T00:00:00+09:00`)
      : null,
    note: input.note.trim(),
    address: input.address.trim(),
    email: input.email.trim(),
  };

  if (input.id) {
    // 自店の顧客であることを必ず検証（他店IDを渡されても更新できない）
    const existing = await getStoreCustomer(own.store.id, input.id);
    if (!existing) return { error: "顧客が見つかりません" };
    await prisma.pitCustomer.update({ where: { id: input.id }, data });
  } else {
    await prisma.pitCustomer.create({ data: { ...data, storeId: own.store.id } });
  }
  revalidatePath(PATH);
  return { ok: true };
}

export async function deletePitCustomer(id: string): Promise<{ ok?: true; error?: string }> {
  const own = await ownPitStore();
  if (!own.store) return { error: own.error };
  const existing = await getStoreCustomer(own.store.id, id);
  if (!existing) return { error: "顧客が見つかりません" };
  // 証明書が紐づく顧客は消せない（法定記録簿の依頼者が空になると記録として成立しない）
  const certs = await prisma.pitCertificate.count({ where: { customerId: id } });
  if (certs > 0) {
    return { error: "この顧客には施工証明書があるため削除できません（記録の保存義務があります）" };
  }
  await prisma.pitCustomer.delete({ where: { id } });
  revalidatePath(PATH);
  return { ok: true };
}
