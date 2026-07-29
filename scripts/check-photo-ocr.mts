/*
 * 施工写真の読み取り結果の正規化を検証する（AI呼び出しは含まない）。
 * DOTとロット番号は「記入漏れ・誤記録が最も起きる項目」なので、正規化と警告を固定しておく。
 *
 * 使い方: npx tsx scripts/check-photo-ocr.mts
 */
import {
  normalizeDot,
  dotLabel,
  normalizeTireSize,
  normalizeOdometer,
  normalizeSoh,
  normalizeLabelText,
  normalizeOcrValues,
  OCR_TARGETS,
} from "../src/server/pit/photo-ocr";

let failed = 0;
const ok = (label: string, cond: boolean, extra = "") => {
  console.log(`${cond ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!cond) failed++;
};
const eq = (label: string, actual: string, expected: string) =>
  ok(`${label}: ${expected === "" ? "（空）" : expected}`, actual === expected, actual === "" ? "（空）" : actual);

// ── DOT（製造週4桁） ──
eq("DOTそのまま", normalizeDot("3223"), "3223");
eq("DOT刻印全体から末尾4桁", normalizeDot("DOT U2LL LMLR 3223"), "3223");
eq("全角DOT", normalizeDot("３２２３"), "3223");
eq("週が54以上は不正として空", normalizeDot("5423"), "");
eq("週が00は不正として空", normalizeDot("0023"), "");
eq("4桁に足りなければ空", normalizeDot("322"), "");
const now = new Date("2026-07-29T00:00:00Z");
eq("DOTの読み替え（2023年32週）", dotLabel("3223", now), "2023年32週");
eq("DOTの読み替え（未来年は前世紀扱いにしない）", dotLabel("0526", now), "2026年5週");
eq("DOTの読み替え（27年は1927ではなく前世紀）", dotLabel("0527", now), "1927年5週");

// ── タイヤサイズ ──
eq("サイズ正規化", normalizeTireSize("195/45R16 84W"), "195/45R16 84W");
eq("全角・空白入りサイズ", normalizeTireSize("１９５／４５Ｒ１６"), "195/45R16");
eq("ZR表記", normalizeTireSize("225/40ZR18 92Y"), "225/40ZR18 92Y");
eq("形が違えば入力を残す（弾かない）", normalizeTireSize("不明"), "不明");

// ── 走行距離 ──
eq("走行距離のカンマを落とす", normalizeOdometer("52,300"), "52300");
eq("単位つきでも数字だけ", normalizeOdometer("52300 km"), "52300");
eq("先頭0を落とす", normalizeOdometer("052300"), "52300");
eq("8桁以上は不正として空", normalizeOdometer("12345678"), "");

// ── SOH ──
eq("SOH", normalizeSoh("92%"), "92");
eq("SOH小数", normalizeSoh("88.5 %"), "88.5");
eq("100超は空", normalizeSoh("120%"), "");

// ── ラベル文字列 ──
eq("ロット番号は記号を残す", normalizeLabelText(" L-2026/07-A "), "L-2026/07-A");
ok("60文字で切る", normalizeLabelText("A".repeat(80)).length === 60);

// ── まとめ ──
const label = normalizeOcrValues("product_label", { product_name: "ガラスコート", maker: "テスト化学", lot_no: "L-01" });
ok("製品ラベル: 3項目そろえば警告なし", label.warnings.length === 0, label.warnings.join("/"));
const noLot = normalizeOcrValues("product_label", { product_name: "ガラスコート", maker: "テスト化学" });
ok(
  "ロット番号が読めなければ警告する（記入漏れを防ぐ）",
  noLot.warnings.some((w) => w.includes("ロット番号")),
  noLot.warnings.join("/"),
);

const tire = normalizeOcrValues("tire", { brand: "PROXES SPORT2", size: "225/40ZR18 92Y", dot: "3223" }, now);
ok("タイヤ: DOTの読み替えを補足に出す", tire.notes.some((n) => n.includes("2023年32週")), tire.notes.join("/"));
const badDot = normalizeOcrValues("tire", { brand: "X", size: "225/40R18", dot: "9999" }, now);
ok(
  "DOTが不正なら値を空にして警告する（誤った製造週を記録しない）",
  badDot.values.dot === "" && badDot.warnings.some((w) => w.includes("DOT")),
  JSON.stringify(badDot.values),
);

const meter = normalizeOcrValues("meter", { odometer_km: "52,300" });
eq("メーター読み取り", meter.values.odometer_km, "52300");
const noMeter = normalizeOcrValues("meter", {});
ok("読めなければ警告して手入力へ促す", noMeter.warnings.length === 1, noMeter.warnings.join("/"));

// 読み取りキーは施工種別モジュールの項目キーと一致していること（フォームへの反映がキー一致で成立する）
const { MODULES } = await import("../src/server/pit/cert-fields");
const pairs: [string, string][] = [
  ["product_label", "coating"],
  ["tire", "tire"],
  ["device_screen", "battery"],
];
for (const [target, moduleKey] of pairs) {
  const t = OCR_TARGETS.find((x) => x.key === target)!;
  const mod = MODULES.find((m) => m.key === moduleKey)!;
  const modKeys = new Set(mod.fields.map((f) => f.key));
  const matched = t.fields.filter((f) => modKeys.has(f));
  ok(
    `${target} の読み取りキーが ${moduleKey} の項目に対応している`,
    matched.length > 0,
    `${matched.join(",")} / 未対応: ${t.fields.filter((f) => !modKeys.has(f)).join(",") || "なし"}`,
  );
}

console.log(failed === 0 ? "\n全チェック合格" : `\n${failed}件のチェックに失敗`);
process.exit(failed === 0 ? 0 : 1);
