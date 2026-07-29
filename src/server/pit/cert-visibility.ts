/*
 * 公開／非公開の境界（唯一の原本）。
 *
 * 最重要要件: 公開ブログ記事には車台番号・登録番号・氏名・住所・連絡先・金額を絶対に出さない。
 * 実装の都合で緩めないために、次の3段で守る。
 *
 *  1. 型で分離   … 公開側に渡せるのは PublicVehicleView / PublicCertificateView だけ。
 *                  非公開フィールドは型に存在しないので、うっかり参照できない。
 *  2. import で分離 … 平文の車台番号を得るには vin-crypto.ts が必要。公開ブログ生成
 *                  （generate.ts / pipeline.ts）はこれを import しない。
 *  3. テストで検証 … 公開HTMLに非公開値が混ざっていないかを assertNoPrivateLeak で検査する
 *                  （scripts/check-public-leak.mts が自動テストとして実行）。
 */

/** 公開ブログ・共有ページ以外へ出してはいけない値の種類 */
export const NEVER_PUBLIC_KEYS = [
  "vin",
  "vinEnc",
  "registrationNumber",
  "regNumberEnc",
  "customerName",
  "customerAddress",
  "customerPhone",
  "customerEmail",
  "staffLicenseNo",
  "certificationNo",
  "totalAmount",
  "restorationCostEstimate",
  "odometerKm",
] as const;

/** 写真の種類のうち、公開ブログへ回してはいけないもの（車検証・ナンバーが写るもの） */
export const NEVER_PUBLIC_MEDIA_KINDS = ["vehicle_plate", "diagnostic_screen"] as const;

/** 公開ブログへ渡せる車両情報（車台番号・登録番号は「存在しない」） */
export type PublicVehicleView = {
  vehicleName: string; // 車名（例: アルファード 30系）
  modelCode: string; // 型式
  maker: string;
  firstRegisteredLabel: string; // 初度登録年月（YYYY年M月まで。日は出さない）
};

/** 公開ブログへ渡せる施工情報 */
export type PublicCertificateView = {
  serviceDateLabel: string; // 施工日
  workSummary: string; // 作業概要
  storeName: string;
  storeArea: string; // 市区町村まで（番地は出さない）
  vehicle: PublicVehicleView;
  photoKeys: string[]; // isPublicSafe な写真のみ
};

type VehicleRow = {
  vehicleName: string | null;
  modelCode: string | null;
  maker: string | null;
  firstRegisteredOn: Date | null;
};

/** 車両レコード → 公開用DTO。非公開項目は構造的に落ちる */
export function toPublicVehicle(v: VehicleRow): PublicVehicleView {
  const d = v.firstRegisteredOn;
  return {
    vehicleName: v.vehicleName ?? "",
    modelCode: v.modelCode ?? "",
    maker: v.maker ?? "",
    firstRegisteredLabel: d
      ? `${d.getFullYear()}年${d.getMonth() + 1}月`
      : "",
  };
}

/** 公開して良い写真だけを抜く */
export function publicSafeMedia<T extends { kind: string; isPublicSafe: boolean; storageKey: string }>(
  media: T[],
): string[] {
  return media
    .filter((m) => m.isPublicSafe && !(NEVER_PUBLIC_MEDIA_KINDS as readonly string[]).includes(m.kind))
    .map((m) => m.storageKey);
}

/**
 * 公開予定のテキスト（記事HTML等）に非公開値が混ざっていないか検査する。
 * 値そのものを渡して部分一致で見る（ハッシュ比較では「一部だけ載った」を検出できない）。
 * 検出したら例外にする＝公開処理を止める。
 */
export function assertNoPrivateLeak(
  publicText: string,
  secrets: { label: string; value: string | null | undefined }[],
): void {
  const hits: string[] = [];
  for (const s of secrets) {
    const v = (s.value ?? "").trim();
    // 短すぎる値（1〜3文字）は誤検知するので対象外。氏名は2文字もあり得るため4文字未満は
    // 呼び出し側で別途扱う（この関数は車台番号・住所・番号類の流出検出が主目的）
    if (v.length < 4) continue;
    if (publicText.includes(v)) hits.push(s.label);
  }
  if (hits.length > 0) {
    throw new Error(
      `公開テキストに非公開情報が含まれています: ${hits.join("・")}（公開処理を中止しました）`,
    );
  }
}
