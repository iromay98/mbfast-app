"use server";

/*
 * mbPIT 車両登録（証明書・法定記録簿の土台）。
 *
 * 入口は車検証の読み取り（/api/pit/shaken-ocr）、フォールバックは手入力。
 * 読み取り結果はこのアクションを通るまで保存されない＝店舗が確認して確定する。
 *
 * 守っていること:
 *  - 店舗はセッションから解決する（クライアントの storeId は受け取らない）
 *  - 車台番号・登録番号は平文で保存しない（vehicle-register.ts で暗号化）
 *  - 車両は必ず自店の顧客に紐づける（他店の車両が一覧に出ない構造）
 */
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { actingPitStore } from "@/server/pit/acting-store";
import {
  registerVehicle,
  vehicleRegistrationReady,
  loadVehicleForEdit,
  updateVehicleInfo,
  type VehicleEditInput,
} from "@/server/pit/vehicle-register";
import { endStoreVehicleLink, getStoreVehicle, linkVehicleToCustomer } from "@/server/pit/customer-repo";
import { normalizeShakenFields } from "@/server/pit/shaken-ocr";
import { isLegalRecordFacility } from "@/server/pit/cert-fields";

const PATH = "/dealer/pit/vehicles";
const HQ_PATH = "/hq/pit/vehicles"; // 本部の代行画面（同じ操作で両方を作り直す）

export type VehicleFormInput = {
  // 車検証の項目（手入力・読み取り結果の修正後）
  vin: string;
  registrationNumber: string;
  vehicleName: string; // 車種表示（公開可・例: アルファード 30系）
  maker: string; // 車検証の「車名」欄
  modelCode: string;
  firstRegistered: string; // "" | YYYY-MM
  inspectionExpiry: string; // "" | YYYY-MM-DD
  // 依頼者（使用者）。既存顧客を選んだ場合は customerId のみ必須
  customerId: string;
  customerName: string;
  customerKana: string;
  customerTel: string;
  customerAddress: string;
  customerEmail: string;
};

export type VehicleFormResult = {
  ok?: true;
  error?: string;
  /** 保存はできたが確認してほしいこと（法定記録簿の必須項目の欠けなど） */
  warnings?: string[];
  vehicleId?: string;
  customerId?: string;
};

function jstDate(ymd: string): Date | null {
  if (!ymd) return null;
  const full = ymd.length === 7 ? `${ymd}-01` : ymd;
  const d = new Date(`${full}T00:00:00+09:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function saveVehicleWithCustomer(
  input: VehicleFormInput,
  /** 本部が代行入力するときの対象店舗。加盟店では無視される（自店に固定） */
  storeId?: string,
): Promise<VehicleFormResult> {
  const own = await actingPitStore(storeId);
  if (!own.store) return { error: own.error };
  const ready = vehicleRegistrationReady();
  if (!ready.ok) return { error: ready.error };

  // 形式の正規化・検証は読み取りと手入力で同じ関数を通す
  const { fields } = normalizeShakenFields({
    vin: input.vin,
    registrationNumber: input.registrationNumber,
    makerName: input.maker,
    modelCode: input.modelCode,
    firstRegistered: input.firstRegistered,
    inspectionExpiry: input.inspectionExpiry,
    userName: input.customerName,
    userAddress: input.customerAddress,
  });
  if (!fields.vin) return { error: "車台番号を入力してください（車検証の「車台番号」欄）" };
  if (input.inspectionExpiry && !fields.inspectionExpiry) {
    return { error: "有効期間の満了する日の形式が正しくありません" };
  }

  // ── 依頼者（顧客） ──
  const name = input.customerName.trim();
  let customerId = input.customerId.trim();
  if (customerId) {
    const existing = await prisma.pitCustomer.findFirst({
      where: { id: customerId, storeId: own.store.id },
      select: { id: true },
    });
    if (!existing) return { error: "顧客が見つかりません" };
  } else {
    if (!name) return { error: "お客様のお名前を入力してください（車検証の「使用者の氏名」）" };
    if (name.length > 60) return { error: "お名前が長すぎます" };
  }
  if (input.customerTel && !/^[0-9+\-]+$/.test(input.customerTel.trim())) {
    return { error: "電話番号は数字・ハイフン・+ のみ使えます" };
  }

  // ── 車両 ──
  const reg = await registerVehicle({
    vin: fields.vin,
    registrationNumber: fields.registrationNumber,
    vehicleName: input.vehicleName.trim() || fields.makerName,
    maker: fields.makerName,
    modelCode: fields.modelCode,
    firstRegisteredOn: jstDate(fields.firstRegistered),
    inspectionExpiry: jstDate(fields.inspectionExpiry),
  });
  if (!reg.vehicle) return { error: reg.error };

  // ── 顧客の作成／更新（入力された項目だけ反映する） ──
  const customerData = {
    ...(name ? { name } : {}),
    ...(input.customerKana.trim() ? { kana: input.customerKana.trim() } : {}),
    ...(input.customerTel.trim() ? { tel: input.customerTel.trim() } : {}),
    ...(input.customerEmail.trim() ? { email: input.customerEmail.trim() } : {}),
    ...(fields.userAddress ? { address: fields.userAddress } : {}),
    ...(input.vehicleName.trim() ? { vehicleName: input.vehicleName.trim() } : {}),
    ...(jstDate(fields.inspectionExpiry) ? { inspectionExpiry: jstDate(fields.inspectionExpiry) } : {}),
  };
  if (customerId) {
    await prisma.pitCustomer.update({ where: { id: customerId }, data: customerData });
  } else {
    const created = await prisma.pitCustomer.create({
      data: { storeId: own.store.id, name, ...customerData },
      select: { id: true },
    });
    customerId = created.id;
  }

  const link = await linkVehicleToCustomer({
    storeId: own.store.id,
    vehicleId: reg.vehicle.id,
    customerId,
  });
  if (link.error) return { error: link.error };

  // 保存は済んだが、後の証明書・記録簿で困る欠けを伝える（入力を弾かずに知らせる）
  const notes: string[] = [];
  if (!fields.registrationNumber) notes.push("登録番号が未入力です（証明書に記載されません）");
  if (!fields.modelCode) notes.push("型式が未入力です");
  if (!fields.inspectionExpiry) notes.push("有効期間の満了する日が未入力です（車検のお知らせが出せません）");
  if (isLegalRecordFacility(own.store.facilityType) && !fields.userAddress) {
    notes.push("依頼者の住所が未入力です。法定記録簿には住所の記載が必要です");
  }

  revalidatePath(PATH);
  revalidatePath(HQ_PATH);
  revalidatePath("/dealer/pit/customers");
  return { ok: true, vehicleId: reg.vehicle.id, customerId, warnings: notes.length ? notes : undefined };
}

/** 登録間違いの訂正・所有権移転（車両そのものは消さない） */
export async function unlinkVehicle(
  vehicleId: string,
  customerId: string,
  storeId?: string,
): Promise<{ ok?: true; error?: string }> {
  const own = await actingPitStore(storeId);
  if (!own.store) return { error: own.error };
  const r = await endStoreVehicleLink({ storeId: own.store.id, vehicleId, customerId });
  if (r.error) return r;
  revalidatePath(PATH);
  revalidatePath(HQ_PATH);
  revalidatePath("/dealer/pit/customers");
  return { ok: true };
}

/**
 * 修正フォームを開くときに現在値を読む。
 * 自店の顧客に紐づく車両だけ（他店の車両は「見つからない」扱い）。
 * 登録番号・車台番号は復号するため監査ログが残る。
 */
export async function loadVehicleEdit(
  vehicleId: string,
  storeId?: string,
): Promise<{ values?: VehicleEditInput & { vin: string }; error?: string }> {
  const own = await actingPitStore(storeId);
  if (!own.store || !own.actor) return { error: own.error };
  const linked = await getStoreVehicle(own.store.id, vehicleId);
  if (!linked) return { error: "車両が見つかりません" };
  const v = await loadVehicleForEdit(vehicleId, { actorUserId: own.actor.id, actorRole: own.actor.role });
  if (!v) return { error: "車両が見つかりません" };
  return {
    values: {
      vin: v.vin,
      vehicleName: v.vehicleName,
      maker: v.maker,
      modelCode: v.modelCode,
      firstRegistered: v.firstRegistered,
      inspectionExpiry: v.inspectionExpiry,
      registrationNumber: v.registrationNumber,
    },
  };
}

/**
 * 車両情報の修正（上書き）。入力ミスを直せるようにするための経路。
 * 車台番号は変更できない（別の車になるため、正しい番号で登録し直す）。
 */
export async function saveVehicleEdit(
  vehicleId: string,
  input: VehicleEditInput,
  storeId?: string,
): Promise<{ ok?: true; error?: string; changed?: string[] }> {
  const own = await actingPitStore(storeId);
  if (!own.store || !own.actor) return { error: own.error };
  const linked = await getStoreVehicle(own.store.id, vehicleId);
  if (!linked) return { error: "車両が見つかりません" };

  const r = await updateVehicleInfo(vehicleId, own.store.id, input, { actorUserId: own.actor.id });
  if (r.error) return { error: r.error };

  // 顧客カルテの表示（車両名・車検満了日）も合わせて更新する
  if (linked.customerId) {
    await prisma.pitCustomer.updateMany({
      where: { id: linked.customerId, storeId: own.store.id },
      data: {
        ...(input.vehicleName.trim() ? { vehicleName: input.vehicleName.trim() } : {}),
        inspectionExpiry: input.inspectionExpiry
          ? new Date(`${input.inspectionExpiry}T00:00:00+09:00`)
          : null,
      },
    });
  }
  revalidatePath(PATH);
  revalidatePath(HQ_PATH);
  revalidatePath("/dealer/pit/customers");
  return { ok: true, changed: r.changed };
}
