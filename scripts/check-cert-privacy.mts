/*
 * 施工証明書 Step A の自動検証。
 * 目的: 「公開ブログに非公開情報を出さない」構造が本当に守られているかを機械的に確かめる。
 *
 * 使い方: npx tsx scripts/check-cert-privacy.mts
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  toPublicVehicle,
  publicSafeMedia,
  assertNoPrivateLeak,
  NEVER_PUBLIC_KEYS,
} from "../src/server/pit/cert-visibility";
import { validateModuleValues, modulesForFacility, moduleAdvice, moduleDef, CORE_FIELDS } from "../src/server/pit/cert-fields";
import { checkCopy, reviewCopy } from "../src/server/pit/copy-guard";
import {
  encryptPii,
  keyIdOf,
  needsRekey,
  decryptForRekeyOnly,
  piiCryptoConfigured,
  resetKeyCache,
} from "../src/server/pit/pii-crypto";
import { resolveRetention, isDeletable, maskPersonName, maskAddress } from "../src/server/pit/cert-retention";
import { certificatePayloadHash } from "../src/server/pit/cert-hash";

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
// ── 5b. 施工種別の細目は任意（記録が生まれないほうが損失。法令項目だけ必須に残す） ──
for (const key of ["coating", "ecu", "tire", "repair_history", "battery"]) {
  const def = moduleDef(key)!;
  const required = def.fields.filter((f) => f.required).map((f) => f.label);
  ok(`${def.label}の細目は必須にしない`, required.length === 0, required.join("・") || "必須なし");
  ok(`${def.label}は空でも保存できる`, validateModuleValues(key, {}).length === 0);
}
const aimingRequired = moduleDef("aiming")!.fields.filter((f) => f.required).map((f) => f.key);
ok(
  "エーミング（法令要件）だけは必須が残る",
  aimingRequired.includes("location_type") && aimingRequired.includes("outsourcing"),
  aimingRequired.join(","),
);

// ── 5c. ECUは施工方法（OBD / ECU直接）で分けて記録できる ──
const ecuFields = moduleDef("ecu")!.fields;
const method = ecuFields.find((f) => f.key === "method");
ok(
  "施工方法をOBDとECU直接で選べる",
  !!method?.options?.some((o) => o.startsWith("OBD")) && !!method?.options?.some((o) => o.includes("ECU直接")),
  (method?.options ?? []).join("/"),
);
const backup = ecuFields.find((f) => f.key === "stock_backup");
ok(
  "他社データで取得できない場合と、同意して取らない場合を区別できる",
  !!backup?.options?.some((o) => o.includes("他社データ")) && !!backup?.options?.some((o) => o.includes("同意")),
  (backup?.options ?? []).join("/"),
);
// 助言（弾かずに伝える）
const obdAdvice = moduleAdvice("ecu", {
  method: "OBD（車両側から）",
  stock_backup: "取得できず（他社データが入っていた）",
});
ok(
  "OBDで純正が取れない場合はECU直接を案内する",
  obdAdvice.some((a) => a.includes("ECU直接")),
  obdAdvice.join(" / "),
);
const consentAdvice = moduleAdvice("ecu", {
  method: "ECU直接（取り外し・ベンチ）",
  stock_backup: "取得しない（お客様の同意あり）",
});
ok("バックアップを取らないなら同意の記録を促す", consentAdvice.some((a) => a.includes("同意")));
ok(
  "揃っていれば余計な注意を出さない",
  moduleAdvice("ecu", {
    method: "OBD（車両側から）",
    stock_backup: "取得済み",
    backup_id: "NAS-2026-07-01",
  }).length === 0,
);

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

// ── 7. 車台番号の暗号化（平文保存しない・鍵はSERVER_SECRETと別・鍵IDを持つ） ──
process.env.SERVER_SECRET = "hmac-key-must-not-be-used-for-aes";
process.env.PII_ENC_KEYS = "k1:test-aes-key-0123456789abcdefghijklmn";
resetKeyCache();
ok("鍵が設定されていれば証明書機能が有効", piiCryptoConfigured());
const enc = encryptPii(vin);
ok("暗号文に平文が含まれない", !enc.includes(vin), enc.slice(0, 28) + "…");
ok("暗号文が鍵IDを持つ（ローテーション対応）", keyIdOf(enc) === "k1", String(keyIdOf(enc)));
ok("復号できる", decryptForRekeyOnly(enc) === vin);
ok("壊れた値はnullを返す（例外にしない）", decryptForRekeyOnly("v2:k1:broken:x:y") === null);
// 鍵ローテーション: 新鍵を先頭に足しても旧鍵の値が読めること／再暗号化対象と判定されること
process.env.PII_ENC_KEYS = "k2:new-aes-key-9876543210zyxwvutsrqpo,k1:test-aes-key-0123456789abcdefghijklmn";
resetKeyCache();
ok("鍵を追加しても旧鍵の暗号文を復号できる", decryptForRekeyOnly(enc) === vin);
ok("旧鍵の値は再暗号化対象と判定される", needsRekey(enc) === true);
ok("新鍵で作った値は再暗号化不要", needsRekey(encryptPii(vin)) === false);
ok("新鍵で暗号化される（鍵IDがk2）", keyIdOf(encryptPii(vin)) === "k2");
// SERVER_SECRET を変えても復号に影響しない（＝AES鍵はSERVER_SECRET由来でない）
process.env.SERVER_SECRET = "totally-different-value";
resetKeyCache();
ok("AES鍵がSERVER_SECRETから独立している", decryptForRekeyOnly(enc) === vin);

// ── 8. 公開ブログ生成から復号モジュールへ辿れないこと（間接importも含めて検査） ──
// 直接importだけ見ると、途中の1ファイルが取り込んだ瞬間に分離が崩れても気づけない。
function resolveImport(spec: string, fromFile: string): string | null {
  const base = spec.startsWith("@/")
    ? join(root, "src", spec.slice(2))
    : spec.startsWith(".")
      ? join(dirname(join(root, fromFile)), spec)
      : null;
  if (!base) return null; // 外部パッケージ
  for (const cand of [`${base}.ts`, `${base}.tsx`, join(base, "index.ts")]) {
    try {
      readFileSync(cand, "utf8");
      return cand.slice(root.length + 1);
    } catch {
      /* 次の候補 */
    }
  }
  return null;
}

function importGraph(entry: string): Set<string> {
  const seen = new Set<string>();
  const queue = [entry];
  while (queue.length) {
    const file = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    let src: string;
    try {
      src = readFileSync(join(root, file), "utf8");
    } catch {
      continue;
    }
    for (const m of src.matchAll(/from\s+"([^"]+)"|import\("([^"]+)"\)/g)) {
      const resolved = resolveImport(m[1] ?? m[2], file);
      if (resolved) queue.push(resolved);
    }
  }
  return seen;
}

for (const f of ["src/server/pit/generate.ts", "src/server/pit/pipeline.ts"]) {
  const reached = importGraph(f);
  const hit = [...reached].filter((p) => p.includes("pii-crypto"));
  ok(`${f} から個人情報の復号モジュールへ辿れない（間接含む）`, hit.length === 0, hit.join(","));
}

// 共有ページ（ログイン不要）は認証除外リストに載っていないと開けない／載せすぎてもいけない
const authConfig = readFileSync(join(root, "src/auth.config.ts"), "utf8");
ok('共有ページ /cert/ が認証不要パスに入っている', authConfig.includes('path.startsWith("/cert/")'));
const certPage = readFileSync(join(root, "src/app/cert/[token]/page.tsx"), "utf8");
ok(
  "共有ページが noindex ＋ mbFAST表記の上書きを使っている",
  certPage.includes("publicCertMetadata"),
);
const metaHelper = readFileSync(join(root, "src/lib/pit-metadata.ts"), "utf8");
ok(
  "お客様向けメタデータは noindex で appleWebApp を上書きする",
  /robots:\s*\{\s*index:\s*false/.test(metaHelper) && metaHelper.includes("appleWebApp: { capable: true, title,"),
);
ok(
  "共有ページは復号を監査ログ経由で行う",
  certPage.includes("readVehicleSecrets") && !certPage.includes("pii-crypto"),
);

// pii-crypto を import してよいファイルを明示する（増えたら気づけるようにする）
const PII_IMPORTERS_ALLOWED = ["src/server/pit/vehicle-register.ts"];
function walkTs(dir: string): string[] {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) => {
    const p = `${dir}/${e.name}`;
    if (e.isDirectory()) return walkTs(p);
    return /\.tsx?$/.test(e.name) ? [p] : [];
  });
}
const importers = walkTs("src").filter(
  (f) => !f.endsWith("pii-crypto.ts") && /from\s+"[^"]*pii-crypto"/.test(readFileSync(join(root, f), "utf8")),
);
ok(
  "復号モジュールを使うファイルは許可した1箇所だけ",
  importers.every((f) => PII_IMPORTERS_ALLOWED.includes(f)),
  importers.join(","),
);

// ── 9. 共通コアの項目定義が公開可否を持つこと ──
const noFlag = CORE_FIELDS.filter((f) => typeof f.publicSafe !== "boolean");
ok("共通コア全項目に公開可否が定義されている", noFlag.length === 0, noFlag.map((f) => f.key).join(","));
const mustBePrivate = ["vin", "registrationNumber", "customerName", "customerAddress", "totalAmount"];
ok(
  "車台番号・氏名・住所・金額が非公開扱いになっている",
  mustBePrivate.every((k) => CORE_FIELDS.find((f) => f.key === k)?.publicSafe === false),
);

// ── 10. 保存期間（目的別・退会でも消さない） ──
const recordedOn = new Date("2026-07-29T00:00:00+09:00");
const legal = resolveRetention({ recordedOn, legalRecord: true });
ok(
  "法定記録簿は記載日から2年保持",
  legal.retentionReason === "legal_record" && legal.retentionUntil?.getFullYear() === 2028,
  String(legal.retentionUntil?.toISOString().slice(0, 10)),
);
const warranty5y = resolveRetention({
  recordedOn,
  legalRecord: true,
  warrantyUntil: new Date("2031-07-29T00:00:00+09:00"),
});
ok(
  "保証5年と法定2年なら長い方（保証満了）まで保持",
  warranty5y.retentionReason === "warranty" && warranty5y.retentionUntil?.getFullYear() === 2031,
  String(warranty5y.retentionUntil?.toISOString().slice(0, 10)),
);
const none = resolveRetention({ recordedOn, legalRecord: false });
ok("保持理由が無ければ期限なし（退会時に削除可）", none.retentionReason === "none" && none.retentionUntil === null);
ok(
  "保存期間内は削除不可",
  !isDeletable({ retentionUntil: legal.retentionUntil, retentionReason: legal.retentionReason }, recordedOn),
);
ok(
  "期限を過ぎれば削除可",
  isDeletable({ retentionUntil: legal.retentionUntil, retentionReason: legal.retentionReason }, new Date("2028-08-01")),
);
ok("氏名マスクは画面表示用（頭1文字＋＊）", maskPersonName("山田太郎") === "山＊＊＊", maskPersonName("山田太郎"));
const maskCases: [string, string][] = [
  ["大阪府堺市北区長曽根町1-2-3", "大阪府堺市北区 以下略"], // 政令市は区まで残す
  ["東京都渋谷区神宮前1-1-1", "東京都渋谷区 以下略"],
  ["兵庫県川辺郡猪名川町木津123", "兵庫県川辺郡猪名川町 以下略"],
  ["奈良県奈良市三条本町1-2", "奈良県奈良市 以下略"],
];
for (const [input, expected] of maskCases) {
  ok(`住所マスク: ${input}`, maskAddress(input) === expected, maskAddress(input));
}

// ── 11. 表現チェックの強度分離（生成文=ブロック／店舗の自由文=警告） ──
const g = reviewCopy("この証明書があれば保険が下ります", "generated");
const u = reviewCopy("この証明書があれば保険が下ります", "user");
ok("生成文の違反はブロック", g.severity === "block");
ok("店舗の自由文は警告に留める（入力を弾かない）", u.severity === "warn", u.message.slice(0, 30) + "…");
ok("問題なければ ok", reviewCopy("施工内容を記録として保存します", "user").severity === "ok");

// ── 12. 内容ハッシュ（改ざん検出・平文の個人情報を含めない） ──
const hashBase = {
  vehicleKey: "hmac-of-vin",
  storeSlug: "test-store",
  customerId: "cus_1",
  certificateType: "coating",
  serviceDate: new Date("2026-07-20T00:00:00+09:00"),
  odometerKm: 52300,
  staffName: "山本",
  workSummary: "ボディ全面のコーティング施工",
  totalAmount: 128000,
  details: [{ module: "coating", fieldKey: "lot_no", fieldValue: "L-2026-07" }],
  issuedAt: new Date("2026-07-29T10:00:00+09:00"),
};
const h1 = certificatePayloadHash(hashBase);
ok("同じ内容なら同じハッシュ", certificatePayloadHash(hashBase) === h1);
ok(
  "1項目変えるとハッシュが変わる（改ざん検出）",
  certificatePayloadHash({ ...hashBase, odometerKm: 52301 }) !== h1,
);
ok(
  "モジュール項目の変更もハッシュに反映される",
  certificatePayloadHash({
    ...hashBase,
    details: [{ module: "coating", fieldKey: "lot_no", fieldValue: "L-2026-08" }],
  }) !== h1,
);
ok(
  "項目の並び順ではハッシュが変わらない（同じ内容は同じ値）",
  certificatePayloadHash({
    ...hashBase,
    details: [
      { module: "coating", fieldKey: "maker", fieldValue: "M" },
      { module: "coating", fieldKey: "lot_no", fieldValue: "L-2026-07" },
    ],
  }) ===
    certificatePayloadHash({
      ...hashBase,
      details: [
        { module: "coating", fieldKey: "lot_no", fieldValue: "L-2026-07" },
        { module: "coating", fieldKey: "maker", fieldValue: "M" },
      ],
    }),
);
const hashSrc = readFileSync(join(root, "src/server/pit/cert-hash.ts"), "utf8");
const certSrc = readFileSync(join(root, "src/server/pit/certificate.ts"), "utf8");
ok(
  "ハッシュ計算に平文の車台番号を使わない（vehicleKeyで表す）",
  hashSrc.includes("vehicleKey: input.vehicleKey") &&
    !hashSrc.includes("pii-crypto") &&
    certSrc.includes("vehicleKey: cert.vehicle.vehicleKey"),
);
ok("ハッシュ計算モジュールはDBに依存しない（単体で検証できる）", !hashSrc.includes("@/lib/db"));

// ── 13. 車検証画像は公開候補にも出さない ──
const shaken = publicSafeMedia([{ kind: "shaken_cert", isPublicSafe: true, storageKey: "shaken.webp" }]);
ok("車検証画像は公開側へ渡らない（明示的にtrueでも）", shaken.length === 0);

// ── 14. 写真の公開判定は「許可リスト方式」（未知の種別は通さない） ──
const unknownKind = publicSafeMedia([
  { kind: "engine_bay_with_vin", isPublicSafe: true, storageKey: "new-kind.webp" },
]);
ok(
  "許可リストに無い新しい種別は、公開可を立てても公開されない（デフォルト除外）",
  unknownKind.length === 0,
);
ok(
  "許可リストにある種別＋公開可 は通る",
  publicSafeMedia([{ kind: "before", isPublicSafe: true, storageKey: "b.webp" }]).length === 1,
);
for (const k of ["meter", "device_screen", "other"]) {
  ok(
    `${k} は公開に回せない（走行距離・機器画面・内容不明は証跡専用）`,
    publicSafeMedia([{ kind: k, isPublicSafe: true, storageKey: `${k}.webp` }]).length === 0,
  );
}

// 写真の実装側: 種別の検査と配信の二重チェックが入っていること
const mediaSrc = readFileSync(new URL("../src/server/pit/cert-media.ts", import.meta.url), "utf8");
ok(
  "アップロード時に許可外の種別へ公開フラグを立てない",
  mediaSrc.includes("input.wantPublic && isPublicAllowedMediaKind(input.kind)"),
);
ok(
  "公開経路の配信でも種別で弾く（DBのフラグが誤っていても漏らさない）",
  /where\.scope === "public" && \(!isPublicAllowedMediaKind\(m\.kind\) \|\| isCertOnlyMediaKind\(m\.kind\)\)/.test(
    mediaSrc,
  ),
);
ok(
  "発行済みの証明書には写真を追加・削除させない",
  mediaSrc.includes("発行済みの証明書には写真を追加できません") &&
    mediaSrc.includes("発行済みの証明書の写真は削除できません"),
);
ok("保存前にEXIFを落とす（processPhoto を通す）", mediaSrc.includes("processPhoto("));
ok(
  "保存キーは推測不能（連番や証明書IDを使わない）",
  mediaSrc.includes("crypto.randomUUID()") && !/storageKey: `pit\/cert-media\/\$\{input\.certificateId/.test(mediaSrc),
);
const publicRoute = readFileSync(
  new URL("../src/app/cert/[token]/media/[mediaId]/route.ts", import.meta.url),
  "utf8",
);
ok(
  "共有ページの写真配信はトークン経由（証明書IDをURLに出さない）",
  publicRoute.includes('scope: "public", shareToken: token') && !publicRoute.includes("certificateId"),
);

// ── 施工証明 → 施工ブログ下書き（導線）の情報境界 ──
// 証明書からブログ下書きへ持ち込むのは公開可の車種・カテゴリだけ。非公開情報は構造的に持ち込まない。
const blogLinkSrc = readFileSync(new URL("../src/server/pit/cert-blog-link.ts", import.meta.url), "utf8");
ok(
  "cert→blog: 車両からは公開可のフィールドだけ読む（maker/vehicleName）",
  /vehicle:\s*\{\s*select:\s*\{\s*maker:\s*true,\s*vehicleName:\s*true\s*\}/.test(blogLinkSrc),
);
ok(
  "cert→blog: 車台番号・登録番号・金額・氏名・住所を一切読まない",
  !/vinEnc|regNumberEnc|totalAmount|restorationCostEstimate/.test(blogLinkSrc) &&
    !/name:\s*true|address:\s*true/.test(blogLinkSrc),
);
ok(
  "cert→blog: PII復号モジュールをimportしない",
  !/pii-crypto|decryptPii|readVehicleSecrets/.test(blogLinkSrc),
);
ok(
  "cert→blog: 下書きは写真なし（証跡写真を自動流用しない）",
  /photoKeys:\s*\[\]/.test(blogLinkSrc) && !/cert-media|media/.test(blogLinkSrc),
);
ok(
  "cert→blog: 作られる投稿は status=\"draft\"（自動公開しない）",
  /status:\s*"draft"/.test(blogLinkSrc),
);

console.log(failed === 0 ? "\n全チェック合格" : `\n${failed}件のチェックに失敗`);
process.exit(failed === 0 ? 0 : 1);
