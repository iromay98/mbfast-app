/*
 * 施工証明書 Step A の自動検証。
 * 目的: 「公開ブログに非公開情報を出さない」構造が本当に守られているかを機械的に確かめる。
 *
 * 使い方: npx tsx scripts/check-cert-privacy.mts
 */
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  toPublicVehicle,
  publicSafeMedia,
  assertNoPrivateLeak,
  NEVER_PUBLIC_KEYS,
} from "../src/server/pit/cert-visibility";
import { validateModuleValues, modulesForFacility, CORE_FIELDS } from "../src/server/pit/cert-fields";
import { checkCopy } from "../src/server/pit/copy-guard";
import { encryptPii, decryptPii, maskVin } from "../src/server/pit/vin-crypto";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;
const ok = (label: string, cond: boolean, extra = "") => {
  console.log(`${cond ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
  if (!cond) failed++;
};

// ── 1. 公開DTOに非公開項目が存在しないこと ──
const pub = toPublicVehicle({
  vehicleName: "アルファード 30系",
  modelCode: "AGH30W",
  maker: "トヨタ",
  firstRegisteredOn: new Date("2019-04-15T00:00:00+09:00"),
});
const pubKeys = Object.keys(pub);
ok(
  "公開用車両DTOに非公開キーが無い",
  !pubKeys.some((k) => (NEVER_PUBLIC_KEYS as readonly string[]).includes(k)),
  pubKeys.join(","),
);
ok("初度登録は年月まで（日を出さない）", pub.firstRegisteredLabel === "2019年4月", pub.firstRegisteredLabel);

// ── 2. 公開テキストへの流出検出 ──
const vin = "ZC33S-123456";
const addr = "大阪府堺市北区長曽根町1-2-3";
const secrets = [
  { label: "車台番号", value: vin },
  { label: "依頼者住所", value: addr },
  { label: "金額", value: "128000" },
];
let leakDetected = false;
try {
  assertNoPrivateLeak(`<p>アルファードのコーティング施工。車台番号 ${vin} の車両です。</p>`, secrets);
} catch {
  leakDetected = true;
}
ok("公開HTMLに車台番号が混ざると公開を止める", leakDetected);

let cleanPassed = true;
try {
  assertNoPrivateLeak("<p>アルファード 30系のコーティング施工。撥水が良好です。</p>", secrets);
} catch {
  cleanPassed = false;
}
ok("非公開情報を含まない記事は通る", cleanPassed);

// ── 3. 公開して良い写真だけが渡ること ──
const media = [
  { kind: "after", isPublicSafe: true, storageKey: "a.webp" },
  { kind: "vehicle_plate", isPublicSafe: true, storageKey: "plate.webp" }, // 種類で除外されるべき
  { kind: "product_label", isPublicSafe: false, storageKey: "label.webp" }, // フラグで除外
];
const keys = publicSafeMedia(media);
ok("車検証・ナンバー写真は公開側へ渡らない", keys.length === 1 && keys[0] === "a.webp", keys.join(","));

// ── 4. 事業場区分による出し分け ──
const general = modulesForFacility("general").map((m) => m.key);
const certified = modulesForFacility("certified").map((m) => m.key);
ok("general事業場にエーミング（特定整備）項目を出さない", !general.includes("aiming"), general.join(","));
ok("認証工場にはエーミング項目を出す", certified.includes("aiming"));

// ── 5. 法令の条件付き必須（エーミング場外実施） ──
const offsite = validateModuleValues("aiming", {
  target_device: "前方カメラ",
  location_type: "作業場以外（場外）",
  outsourcing: "自社",
});
const offsiteKeys = offsite.map((e) => e.fieldKey);
ok(
  "場外実施なら 場所・天候・理由が必須になる",
  ["offsite_place", "offsite_weather", "offsite_reason"].every((k) => offsiteKeys.includes(k)),
  offsiteKeys.join(","),
);
const inside = validateModuleValues("aiming", {
  target_device: "前方カメラ",
  location_type: "電子制御装置点検整備作業場",
  outsourcing: "自社",
});
ok("作業場内なら天候・理由は不要", inside.length === 0, inside.map((e) => e.fieldKey).join(","));
const outsourced = validateModuleValues("aiming", {
  target_device: "前方カメラ",
  location_type: "電子制御装置点検整備作業場",
  outsourcing: "外注",
});
ok(
  "外注なら外注先名が必須になる",
  outsourced.some((e) => e.fieldKey === "outsourcing_to"),
);
// ECU: バックアップ取得済みなら保管IDが必須
const ecu = validateModuleValues("ecu", {
  ecu_model: "MED17",
  stock_backup: "取得済み",
  revertible: "可",
});
ok("純正バックアップ取得済みなら保管IDが必須", ecu.some((e) => e.fieldKey === "backup_id"));

// ── 6. 禁止表現 ──
const bad = [
  "この証明書があれば保険が下ります",
  "車検に通ります",
  "査定額が上がります",
  "リセールバリューが向上します",
];
ok(
  "禁止表現を検出する",
  bad.every((t) => checkCopy(t).length > 0),
  bad.map((t) => `${t}:${checkCopy(t).length}`).join(" / "),
);
const good = [
  "施工内容と金額を記録として保存します",
  "保険会社への説明資料として利用できます",
  "施工履歴を第三者に提示できる形で残せます",
];
ok(
  "事実の記述は通す",
  good.every((t) => checkCopy(t).length === 0),
  good.map((t) => `${t}:${checkCopy(t).length}`).join(" / "),
);

// ── 7. 車台番号の暗号化（平文保存しない） ──
process.env.SERVER_SECRET ||= "local-test-secret-for-cert-privacy-check";
const enc = encryptPii(vin);
ok("暗号文に平文が含まれない", !enc.includes(vin), enc.slice(0, 24) + "…");
ok("復号できる", decryptPii(enc) === vin);
ok("壊れた値はnullを返す（例外にしない）", decryptPii("v1:broken:x:y") === null);
ok("マスク表示は末尾のみ残す", maskVin(vin).endsWith("56") && !maskVin(vin).includes("1234"), maskVin(vin));

// ── 8. 公開ブログ生成が復号モジュールを import していないこと（構造的な分離） ──
for (const f of ["src/server/pit/generate.ts", "src/server/pit/pipeline.ts"]) {
  const src = readFileSync(join(root, f), "utf8");
  ok(`${f} が vin-crypto を import していない`, !src.includes("vin-crypto"));
}

// ── 9. 共通コアの項目定義が公開可否を持つこと ──
const noFlag = CORE_FIELDS.filter((f) => typeof f.publicSafe !== "boolean");
ok("共通コア全項目に公開可否が定義されている", noFlag.length === 0, noFlag.map((f) => f.key).join(","));
const mustBePrivate = ["vin", "registrationNumber", "customerName", "customerAddress", "totalAmount"];
ok(
  "車台番号・氏名・住所・金額が非公開扱いになっている",
  mustBePrivate.every((k) => CORE_FIELDS.find((f) => f.key === k)?.publicSafe === false),
);

console.log(failed === 0 ? "\n全チェック合格" : `\n${failed}件のチェックに失敗`);
process.exit(failed === 0 ? 0 : 1);
