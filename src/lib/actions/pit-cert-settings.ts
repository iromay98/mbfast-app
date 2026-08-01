"use server";

/*
 * 施工証明書の体裁・記載範囲と、AI記事の公開前確認の店舗設定。
 *
 * 店舗の解決は actingPitStore だけを通す＝加盟店は引数のstoreIdを無視して自店固定、
 * 本部だけが任意店舗を指定できる（他店の設定を書き換えられない保証を崩さない）。
 *
 * ここで扱う項目は **WordPressへは同期しない**（store-meta.ts の STORE_META_FIELDS に
 * 載せていないため構造的に流れない）。アプリ内の帳票と投稿フローにだけ効く。
 */

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { actingPitStore } from "@/server/pit/acting-store";
import { notify } from "@/server/notifications";

export type CertSettingsInput = {
  /** 本部のみ有効（加盟店は無視され自店になる） */
  storeId?: string;
  certBrandName: string;
  certShowCustomerName: boolean;
  certShowCustomerAddress: boolean;
  certShowCustomerTel: boolean;
  certShowAmount: boolean;
  postReviewRequired: boolean;
};

const MAX_BRAND_NAME = 40;

export async function updateCertSettings(
  input: CertSettingsInput,
): Promise<{ ok?: true; error?: string; noticeLegal?: string }> {
  const ctx = await actingPitStore(input.storeId);
  if (!ctx.store || !ctx.actor) return { error: ctx.error ?? "権限がありません" };

  const brandName = input.certBrandName.trim();
  if (brandName.length > MAX_BRAND_NAME) {
    return { error: `ブランド名は${MAX_BRAND_NAME}文字以内で入力してください` };
  }
  // 帳票に流し込むテキストなのでタグは受け付けない（店舗情報の validateStoreInfo と同じ方針）
  if (/[<>]/.test(brandName)) return { error: "ブランド名にHTMLタグは使えません" };

  await prisma.pitStore.update({
    where: { id: ctx.store.id },
    data: {
      certBrandName: brandName,
      certShowCustomerName: input.certShowCustomerName,
      certShowCustomerAddress: input.certShowCustomerAddress,
      certShowCustomerTel: input.certShowCustomerTel,
      certShowAmount: input.certShowAmount,
      postReviewRequired: input.postReviewRequired,
    },
  });

  /*
   * 法定記録簿モード（認証工場・指定工場）では、依頼者の氏名・住所は法令上の必須記載事項。
   * OFFにしても記録簿としての出力では表示に戻る（cert-display.ts が上書きする）。
   * 設定は保存するが、画面でそのことを伝える。
   */
  const legalFacility = ctx.store.facilityType !== "general";
  const turnedOffLegal = !input.certShowCustomerName || !input.certShowCustomerAddress;
  const noticeLegal =
    legalFacility && turnedOffLegal
      ? "この店舗は認証工場・指定工場のため、法定記録簿として出す証明書では依頼者の氏名・住所は法令上の必須記載事項として表示されます（記載が欠けると記録として成立しないため）。それ以外の証明書では設定どおり非表示になります。"
      : undefined;

  // 加盟店が自分で変えたときは本部に伝える（店舗情報の自己編集と同じ扱い）
  if (ctx.actor.role === "dealer") {
    await notify({
      type: "PIT_STORE_INFO_CHANGED",
      title: "mbPIT 証明書設定が変更されました",
      message:
        `${ctx.store.displayName} が証明書設定を変更しました。` +
        `ブランド名: ${brandName || "（未設定＝店舗名を使用）"} / ` +
        `氏名: ${input.certShowCustomerName ? "載せる" : "載せない"} / ` +
        `住所: ${input.certShowCustomerAddress ? "載せる" : "載せない"} / ` +
        `連絡先: ${input.certShowCustomerTel ? "載せる" : "載せない"} / ` +
        `金額: ${input.certShowAmount ? "載せる" : "載せない"} / ` +
        `公開前確認: ${input.postReviewRequired ? "する" : "しない"}`,
      link: "/hq/pit",
    });
  }

  revalidatePath("/dealer/pit/store");
  revalidatePath("/hq/pit");
  return { ok: true, noticeLegal };
}
