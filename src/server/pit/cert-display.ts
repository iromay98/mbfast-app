/*
 * 施工証明書に「何を載せるか」の判定。**ここが唯一の原本**。
 *
 * 店舗設定（PitStore.certShow*）で、お客様へ渡す証明書・共有ページから
 * 依頼者の氏名・住所・連絡先・金額を外せるようにする（個人情報保護の都合）。
 *
 * ただし **法定記録簿モードでは必須記載事項を外せない**。
 * 認証工場・指定工場の点検整備記録簿は、依頼者の氏名と住所が法令上の必須記載事項で、
 * legal-record.ts の missingLegalFields() が欠けを検出して発行をブロックする。
 * 「載せない」設定でそこを空にすると記録として成立しないため、
 * legalRecord=true のときは氏名・住所を強制的に表示に戻す（設定より法令が優先）。
 *
 * 重要な区別:
 *  - これは「帳票に印字するか」だけの判定。**保存する値は変えない**
 *    （記録の保存義務は事業者本人に残るため、DBからは消さない。cert-retention.ts 参照）
 *  - 公開ブログ（WordPress）に何を出すかは **別の境界**で、cert-visibility.ts が原本。
 *    公開ブログには氏名・住所・連絡先・金額・車台番号を**設定に関係なく一切出さない**。
 *    このファイルの設定で公開ブログ側が緩むことは無い。
 */

/** 店舗側の表示設定（PitStore の該当列だけを取り出したもの） */
export type CertDisplaySettings = {
  certBrandName: string;
  certShowCustomerName: boolean;
  certShowCustomerAddress: boolean;
  certShowCustomerTel: boolean;
  certShowAmount: boolean;
};

/** 実際に帳票へ印字するかどうかの解決結果 */
export type ResolvedCertDisplay = {
  /** 帳票左上に出すブランド名（空なら呼び出し側が店舗名にフォールバック） */
  brandName: string;
  showCustomerName: boolean;
  showCustomerAddress: boolean;
  showCustomerTel: boolean;
  showAmount: boolean;
  /** 設定はOFFだが法令要件で表示に戻した項目（画面で理由を出すため） */
  forcedByLegal: string[];
};

/**
 * 店舗設定と法定記録簿フラグから、帳票の表示可否を解決する。
 * legalRecord=true のときは氏名・住所のOFFを無効化する（法令が設定より優先）。
 */
export function resolveCertDisplay(
  s: CertDisplaySettings,
  legalRecord: boolean,
): ResolvedCertDisplay {
  const forcedByLegal: string[] = [];
  let showCustomerName = s.certShowCustomerName;
  let showCustomerAddress = s.certShowCustomerAddress;

  if (legalRecord) {
    // 法定記録簿の必須記載事項（legal-record.ts の missingLegalFields と対応）
    if (!showCustomerName) {
      showCustomerName = true;
      forcedByLegal.push("依頼者の氏名または名称");
    }
    if (!showCustomerAddress) {
      showCustomerAddress = true;
      forcedByLegal.push("依頼者の住所");
    }
  }

  return {
    brandName: s.certBrandName.trim(),
    showCustomerName,
    showCustomerAddress,
    showCustomerTel: s.certShowCustomerTel,
    showAmount: s.certShowAmount,
    forcedByLegal,
  };
}

/** 表示しない項目は帳票へ空文字で渡す（値そのものは保存されたまま） */
export function hideIf(show: boolean, value: string): string {
  return show ? value : "";
}
