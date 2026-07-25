/*
 * 生成テンプレートの規約チェック（CI用grep）。
 *  - class名に active / hidden を使っていない（テーマCSSとの衝突防止）
 *  - <script> 内が ES5 のみ（アロー関数・const/let・テンプレートリテラル・includes等の禁止）
 *  - 全クラスがブランドプレフィックスで始まる
 * DB不要: 15ブランド分の合成ブランド定義でテンプレートと行HTMLを生成して検査する。
 *
 * 使い方: tsx scripts/check-generated-templates.mts
 */
import { buildGeneratedTemplate } from "../src/lib/prices/generated-template";
import { generatePriceTableHtml } from "../src/lib/prices/generate-html";
import type { BrandRow, ColumnDefinition, VehicleRow } from "../src/lib/prices/types";

const PREFIXES = [
  "toyota-", "nissan-", "lexus-", "honda-", "fuso-", "porsche-", "mini-", "ferrari-",
  "maserati-", "mclaren-", "landrover-", "jaguar-", "chevrolet-", "ford-", "cdj-",
];

// 全列タイプを含む合成カラム（実ブランドの上位集合）
const COLUMNS: ColumnDefinition[] = [
  { key: "car", label: "車種", type: "text", order: 0 },
  { key: "grade", label: "グレード", type: "text", order: 1 },
  { key: "engine", label: "エンジン", type: "text", order: 2 },
  { key: "limiterCut", label: "リミッター解除のみ", type: "price", emptyBehavior: "line-btn", order: 3 },
  { key: "babble", label: "バブリングのみ", type: "price", emphasis: "primary", emptyBehavior: "line-btn", order: 4 },
  { key: "stage1", label: "ECUﾁｭｰﾆﾝｸﾞ(ﾊﾞﾌﾞﾘﾝｸﾞ無料)", type: "price", emphasis: "primary", emptyBehavior: "line-btn", order: 5 },
  { key: "tcu", label: "TCUﾁｭｰﾆﾝｸﾞ", type: "price", emptyBehavior: "line-btn", order: 6 },
  { key: "stockOutput", label: "純正出力", type: "output", order: 7 },
  { key: "stage1Gain", label: "Stage1出力向上", type: "output", order: 8 },
  { key: "labor", label: "工賃", type: "labor", order: 9 },
  { key: "shops", label: "対応店舗", type: "shops", order: 10 },
  { key: "remote", label: "リモート", type: "remote", order: 11 },
  { key: "ecuType", label: "ECU/TCU型番", type: "ecu", order: 12 },
];

const VEHICLE: VehicleRow = {
  id: "check",
  seriesGroup: "Test",
  carName: "Test Car (X99)",
  grade: "S550",
  engine: "M999",
  engineFamily: null,
  ecuType: "MG1CS999",
  stockOutput: "500ps/700Nm",
  stage1Gain: "+80ps/100Nm",
  prices: { babble: "121000", stage1: "165000" }, // limiterCut/tcu は未設定 = LINEボタン経路も通す
  labor: null,
  shops: "本店",
  remote: { autoTuner: true, flasher: false },
  notes: "備考テスト",
  displayOrder: 0,
};

// <script>…</script> 部分の 禁止パターン（ES5違反＋WPレンダーフィルタ対策）
const ES6_PATTERNS: [RegExp, string][] = [
  // WPは本文レンダー時、script内でも裸の「<」をタグ開始と誤認し、以降の & を &#038; に
  // エンティティ化してJSを破壊する（Ferrariページで実証）。比較は「length > i」形式にする。
  [/</, "裸の <（WPレンダーフィルタがJSを破壊。比較は length > i 形式にする）"],
  [/=>/, "アロー関数"],
  [/\bconst\s/, "const"],
  [/\blet\s/, "let"],
  [/`/, "テンプレートリテラル"],
  [/\.includes\(/, "String/Array.prototype.includes"],
  [/Array\.from\(/, "Array.from"],
  [/\bfor\s*\(\s*(const|let)\b/, "for(const/let)"],
  [/\.\.\./, "スプレッド構文"],
  [/\bclass\s+[A-Z]/, "class構文"],
  [/dataset\./, "dataset（getAttribute を使う）"],
];

let ng = 0;
const fail = (prefix: string, msg: string) => {
  ng++;
  console.error(`❌ ${prefix} ${msg}`);
};

for (const p of PREFIXES) {
  const brand: BrandRow = {
    id: `check_${p.replace(/-$/, "")}`,
    displayName: p.replace(/-$/, "").toUpperCase(),
    slug: p.replace(/-$/, ""),
    namespacePrefix: p,
    seriesGroups: ["Test", "Other"],
    columns: COLUMNS,
    intro: "",
    jsonLdDescription: "",
    wordPressPageId: null,
    vehicleCount: 1,
  };
  buildGeneratedTemplate(brand); // 生成が通ること
  const html = generatePriceTableHtml(brand, [VEHICLE]);

  // 1) class属性に active / hidden という独立トークンが無い
  for (const m of html.matchAll(/class="([^"]*)"/g)) {
    for (const token of m[1].split(/\s+/).filter(Boolean)) {
      if (token === "active" || token === "hidden") fail(p, `禁止クラス名: class="${m[1]}"`);
      if (!token.startsWith(p)) fail(p, `プレフィックス無しクラス: "${token}"`);
    }
  }
  // 2) CSSセレクタにも .active / .hidden が無い
  if (/\.active\b/.test(html) || /\.hidden\b/.test(html)) fail(p, "CSSに .active / .hidden がある");
  // 3) hidden属性も不使用（WPテーマのCSSで上書きされる事故防止。style個別制御に統一）
  if (/<[^>]+\shidden[\s>]/.test(html)) fail(p, "hidden属性を使っている");
  // 4) <script>内（JSON-LDを除く）が ES5 のみ
  for (const sm of html.matchAll(/<script(?![^>]*application\/ld\+json)[^>]*>([\s\S]*?)<\/script>/g)) {
    for (const [re, label] of ES6_PATTERNS) {
      if (re.test(sm[1])) fail(p, `<script>にES5違反: ${label}`);
    }
  }
  // 5) id もプレフィックス付き
  for (const im of html.matchAll(/id="([^"]*)"/g)) {
    if (!im[1].startsWith(p)) fail(p, `プレフィックス無しid: "${im[1]}"`);
  }
}

if (ng === 0) {
  console.log(`✅ ${PREFIXES.length}ブランド全て合格（クラス/ID プレフィックス・active/hidden不使用・ES5のみ）`);
  process.exit(0);
}
console.error(`\n${ng}件の違反`);
process.exit(1);
