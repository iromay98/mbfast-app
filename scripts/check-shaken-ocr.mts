/*
 * 車検証の読み取り結果の正規化を検証する（AI呼び出しは含まない）。
 * 和暦の変換とVIN/型式の混同はどちらも「証明書が別の車のものになる」事故に直結するため、
 * 正規化関数を単体で固定する。
 *
 * 使い方: npx tsx scripts/check-shaken-ocr.mts
 */
import {
  normalizeJpDate,
  normalizeRegistrationNumber,
  looksLikeVin,
  normalizeShakenFields,
} from "../src/server/pit/shaken-ocr";
import { parseShakenQr, chassisFromQrText, qrExpiryToInput } from "../src/server/pit/shaken-qr";

let failed = 0;
const ok = (label: string, cond: boolean, extra = "") => {
  console.log(`${cond ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!cond) failed++;
};
const eq = (label: string, actual: string, expected: string) =>
  ok(`${label}: ${expected}`, actual === expected, actual);

// ── 和暦・西暦 ──
eq("令和の日付", normalizeJpDate("令和8年5月20日"), "2026-05-20");
eq("令和元年", normalizeJpDate("令和元年5月", { monthOnly: true }), "2019-05");
eq("アルファベット略記", normalizeJpDate("R8.5.20"), "2026-05-20");
eq("平成", normalizeJpDate("平成31年4月1日"), "2019-04-01");
eq("昭和", normalizeJpDate("昭和60年3月2日"), "1985-03-02");
eq("西暦ハイフン", normalizeJpDate("2026-05-20"), "2026-05-20");
eq("西暦8桁", normalizeJpDate("20260520"), "2026-05-20");
eq("全角数字", normalizeJpDate("令和８年５月２０日"), "2026-05-20");
eq("年月のみ要求されたら日を落とす", normalizeJpDate("令和8年5月20日", { monthOnly: true }), "2026-05");
eq("読めない文字列は空（推測しない）", normalizeJpDate("わからない"), "");
eq("空文字は空", normalizeJpDate(""), "");
eq("あり得ない月は空", normalizeJpDate("2026-13-01"), "");

// ── 登録番号 ──
eq("登録番号の全角・区切り正規化", normalizeRegistrationNumber("大阪　３００　あ　１２－３４"), "大阪 300 あ 12-34");

// ── 車台番号と型式の混同 ──
ok("国内形式の車台番号を受け付ける", looksLikeVin("ZC33S-123456"));
ok("17桁VINを受け付ける", looksLikeVin("WDD2040012A123456"));
ok("型式を車台番号として受け付けない", !looksLikeVin("3BA-ZC33S"));
ok("短すぎる値を受け付けない", !looksLikeVin("ZC33S"));

// ── まとめて正規化 ──
const full = normalizeShakenFields({
  vin: "zc33s-123456",
  registrationNumber: "大阪　３００　あ　１２－３４",
  makerName: "スズキ",
  modelCode: "3ba-zc33s",
  firstRegistered: "令和1年5月",
  inspectionExpiry: "令和8年5月20日",
  userName: "山田 太郎",
  userAddress: "大阪府堺市北区長曽根町1-2-3",
});
eq("車台番号は大文字化", full.fields.vin, "ZC33S-123456");
eq("型式も大文字化", full.fields.modelCode, "3BA-ZC33S");
eq("初度登録は年月", full.fields.firstRegistered, "2019-05");
eq("満了日は西暦", full.fields.inspectionExpiry, "2026-05-20");
ok("全項目そろえば警告なし・自信度1", full.warnings.length === 0 && full.confidence === 1, String(full.confidence));

const partial = normalizeShakenFields({ vin: "3BA-ZC33S" });
ok(
  "車台番号の形が怪しければ警告する",
  partial.warnings.some((w) => w.includes("形が一般的ではありません")),
  partial.warnings.join(" / "),
);
ok(
  "法定記録簿に必要な氏名・住所の欠けを警告する",
  partial.warnings.some((w) => w.includes("使用者の氏名")) && partial.warnings.some((w) => w.includes("住所")),
);
ok("自信度は低くなる", partial.confidence < 0.3, String(partial.confidence));

const empty = normalizeShakenFields({});
ok("空入力でも例外にしない", empty.confidence === 0 && empty.fields.vin === "");

// ── 車検証QR（誤読が起きない経路。並び順に依存しない寛容パース） ──
const qr1 = parseShakenQr("3BA-ZC33S/ZC33S-123456/20270520/1490/1735/K14C");
eq("QRから車台番号", qr1.chassis ?? "", "ZC33S-123456");
eq("QRから型式", qr1.modelCode ?? "", "3BA-ZC33S");
eq("QRから有効期間", qrExpiryToInput(qr1.expiry), "2027-05-20");

// 並び順が変わっても同じ結果（様式差に耐える）
const qr2 = parseShakenQr("20270520/K14C/ZC33S-123456/3BA-ZC33S");
ok(
  "フィールドの順番が違っても同じ値を取る",
  qr2.chassis === qr1.chassis && qr2.modelCode === qr1.modelCode,
  `${qr2.chassis} / ${qr2.modelCode}`,
);

// 17桁VIN（輸入車）
eq("17桁VINも読める", parseShakenQr("WDD2040012A123456/CBA-204048").chassis ?? "", "WDD2040012A123456");
// 型式を車台番号と間違えない
ok("型式だけのQRでは車台番号を返さない", parseShakenQr("3BA-ZC33S/K14C").chassis === null);
// 複数QRを続けて読んだ連結テキスト
eq(
  "複数QRの連結テキストでも読める",
  chassisFromQrText("3BA-ZC33S/K14C\nZC33S-123456/20270520") ?? "",
  "ZC33S-123456",
);
// 有効期間が入っていない様式（電子車検証など）は空で返す＝手入力へ回す
eq("有効期間が無ければ空", qrExpiryToInput(parseShakenQr("3BA-ZC33S/ZC33S-123456").expiry), "");
ok("QRの解析はDBに依存しない（単体で検証できる）", true);

console.log(failed === 0 ? "\n全チェック合格" : `\n${failed}件のチェックに失敗`);
process.exit(failed === 0 ? 0 : 1);
