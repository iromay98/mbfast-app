/*
 * 車検証QRの解析（DBにも暗号にも依存しない純関数）。
 *
 * なぜQRを使うか: 車台番号と型式は**文字認識の誤読が事故になる**項目。QRなら誤読が無い。
 * 一方でQRには使用者の氏名・住所が入っていないので、そこは券面の写真OCRか手入力で補う。
 *
 * フォーマットについて:
 *  国交省の車検証QRは「/」区切りのフィールド列だが、様式・発行時期で並びが変わる。
 *  並び順に依存せず**フィールドの形**で判定する寛容パースにしている（順番が変わっても壊れない）。
 *  複数QRを続けて読んだ連結テキストもそのまま渡せる。
 *
 * サーバー（車両登録）とクライアント（カメラのスキャナ）で同じ関数を使う＝判定がズレない。
 */
import { normalizeChassis } from "@/server/pit/chassis";

export type ParsedShakenQr = {
  /** 車台番号（例: ZC33S-123456 / 17桁VIN） */
  chassis: string | null;
  /** 型式（例: 3BA-ZC33S） */
  modelCode: string | null;
  /** 有効期間の満了する日（YYYYMMDD形式が入っている様式のみ。無ければ null） */
  expiry: Date | null;
};

/** 車台番号として妥当な形か（17桁VIN、または「英数-数字」の国内形式） */
function isChassis(f: string): boolean {
  return /^[A-Z][A-Z0-9]{1,9}-\d{4,8}$/.test(f) || /^[A-HJ-NPR-Z0-9]{17}$/.test(f);
}

/** 型式か（先頭が排ガス規制コード＝数字始まり。例 3BA-ZC33S） */
function isModelCode(f: string): boolean {
  return /^[A-Z0-9]{2,4}-[A-Z][A-Z0-9]{1,9}$/.test(f) && /^\d/.test(f);
}

export function parseShakenQr(text: string): ParsedShakenQr {
  const fields = (text ?? "")
    .split(/[/\n\r]+/)
    .map((f) => normalizeChassis(f.trim()))
    .filter(Boolean);

  let chassis: string | null = null;
  let modelCode: string | null = null;
  let expiry: Date | null = null;

  for (const f of fields) {
    if (!modelCode && isModelCode(f)) {
      modelCode = f;
      continue;
    }
    if (!chassis && isChassis(f)) {
      chassis = f;
      continue;
    }
    if (!expiry && /^(20\d{2})(0[1-9]|1[0-2])(0[1-9]|[12]\d|3[01])$/.test(f)) {
      const y = Number(f.slice(0, 4));
      const m = Number(f.slice(4, 6));
      const d = Number(f.slice(6, 8));
      if (y >= 2020 && y <= 2050) expiry = new Date(Date.UTC(y, m - 1, d));
    }
  }
  return { chassis, modelCode, expiry };
}

/** 車台番号だけ欲しいとき（スキャナが「読み取り完了」を判定するのに使う） */
export function chassisFromQrText(text: string): string | null {
  return parseShakenQr(text).chassis;
}

/** 有効期間を input[type=date] 用の YYYY-MM-DD にする */
export function qrExpiryToInput(expiry: Date | null): string {
  return expiry ? expiry.toISOString().slice(0, 10) : "";
}
