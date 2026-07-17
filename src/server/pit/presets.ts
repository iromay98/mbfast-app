// mbPIT 初期5店舗の WordPress カテゴリ（作成済み・ID確定）。
// HQ の店舗マスタ登録画面でプリセットとして提示する（footer_html は本部が後から投入）。
// 親カテゴリ: mbPIT施工記録 (ID 545, slug: mbpit)

export type PitStorePreset = {
  displayName: string;
  wpCategoryId: number;
  storeSlug: string;
};

export const INITIAL_PIT_STORES: PitStorePreset[] = [
  { displayName: "CharismGarage", wpCategoryId: 547, storeSlug: "charism-garage" },
  { displayName: "On's", wpCategoryId: 549, storeSlug: "ons-mbpit" },
  { displayName: "Anubis Garage", wpCategoryId: 551, storeSlug: "anubis-garage" },
  { displayName: "プレジャー", wpCategoryId: 553, storeSlug: "pleasure" },
  { displayName: "Glanzcoat", wpCategoryId: 555, storeSlug: "glanzcoat-mbpit" },
];
