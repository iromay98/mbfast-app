/*
 * 完成済みの価格表HTML（5ブランド・計870モデル）を解析して PriceBrand / PriceVehicle に投入する。
 * HTML自体が整形済みの正解データなので、これを唯一の初期データ源とする。
 *
 * 使い方: tsx scripts/import-price-html.mts <htmlディレクトリ>
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

// ── ブランドごとの定義（HTMLの実物から確定させたもの） ──
type ColDef = {
  key: string;
  label: string;
  labelHtml?: string;
  type: "price" | "text" | "output" | "labor" | "shops" | "remote" | "ecu";
  emphasis?: "primary" | "secondary" | "muted";
  emptyBehavior?: "line-btn" | "dash";
  order: number;
};

type BrandSpec = {
  id: string;
  file: string;
  displayName: string;
  slug: string;
  namespacePrefix: string;
  ns: string; // HTML内のクラス接頭辞（"" | "audi-" | "mbd-"）
  searchAttr: string; // data-search / data-audi-search / data-mbd-search
  seriesAttr: string;
  hasGrade: boolean;
  hasEngine: boolean;
  priceCells: { key: string; cls: string; label: string }[]; // 価格セル（cell-price-xxx）
  columns: ColDef[];
  jsonLdDescription: string;
};

const BRANDS: BrandSpec[] = [
  {
    id: "bmw",
    file: "bmw_price_table.html",
    displayName: "BMW",
    slug: "bmw",
    namespacePrefix: "bmw-",
    ns: "",
    searchAttr: "data-search",
    seriesAttr: "data-series",
    hasGrade: true,
    hasEngine: true,
    priceCells: [
      { key: "babble", cls: "cell-price-babble", label: "バブリングのみ" },
      { key: "stage1", cls: "cell-price-stage1", label: "ECUチューニング(バブ無料)" },
    ],
    columns: [
      { key: "car", label: "車種 (型式)", type: "text", order: 0 },
      { key: "grade", label: "グレード", type: "text", order: 1 },
      { key: "engine", label: "エンジン", type: "text", order: 2 },
      { key: "babble", label: "バブリングのみ", labelHtml: "バブリング<br>のみ", type: "price", emphasis: "primary", emptyBehavior: "line-btn", order: 3 },
      { key: "stage1", label: "ECUチューニング(バブ無料)", labelHtml: "ECUチューニング<br><small>(バブ無料)</small>", type: "price", emphasis: "primary", emptyBehavior: "line-btn", order: 4 },
      { key: "labor", label: "脱着等工賃", type: "labor", order: 5 },
      { key: "stockOutput", label: "純正出力", type: "output", order: 6 },
      { key: "stage1Gain", label: "Stage1出力向上", labelHtml: "Stage1<br>出力向上", type: "output", order: 7 },
      { key: "remote", label: "リモート", type: "remote", order: 8 },
      { key: "ecuType", label: "ECU/TCU型番", labelHtml: "ECU/TCU<br>型番", type: "ecu", order: 9 },
    ],
    jsonLdDescription:
      "BMW全車種(1〜8シリーズ・X1〜X7・Z3〜Z8・i8・Mモデル)対応のECUチューニング・バブリング施工サービス。B58・N55・S58・S55など全エンジン対応。",
  },
  {
    id: "mercedes_gasoline",
    file: "mercedes_price_table.html",
    displayName: "Mercedes(ガソリン)",
    slug: "mercedes",
    namespacePrefix: "mb-",
    ns: "",
    searchAttr: "data-search",
    seriesAttr: "data-series",
    hasGrade: true,
    hasEngine: true,
    priceCells: [
      { key: "babble", cls: "cell-price-babble", label: "バブリング" },
      { key: "stage1", cls: "cell-price-stage1", label: "Stage1" },
      { key: "stage15", cls: "cell-price-stage15", label: "Stage1.5" },
      { key: "stage2", cls: "cell-price-stage2", label: "Stage2" },
    ],
    columns: [
      { key: "car", label: "車種 (型式)", type: "text", order: 0 },
      { key: "grade", label: "グレード", type: "text", order: 1 },
      { key: "engine", label: "エンジン", type: "text", order: 2 },
      { key: "babble", label: "バブリングのみ", labelHtml: "バブリング<br>のみ", type: "price", emphasis: "primary", emptyBehavior: "line-btn", order: 3 },
      { key: "stage1", label: "Stage1(バブ無料)", labelHtml: "Stage1<br><small>(バブ無料)</small>", type: "price", emphasis: "primary", emptyBehavior: "line-btn", order: 4 },
      { key: "stage15", label: "Stage1.5(バブ無料)", labelHtml: "Stage1.5<br><small>(バブ無料)</small>", type: "price", emphasis: "secondary", emptyBehavior: "line-btn", order: 5 },
      { key: "stage2", label: "Stage2(バブ無料)", labelHtml: "Stage2<br><small>(バブ無料)</small>", type: "price", emphasis: "secondary", emptyBehavior: "line-btn", order: 6 },
      { key: "labor", label: "脱着・殻割工賃", labelHtml: "脱着・殻割<br>工賃", type: "labor", order: 7 },
      { key: "stockOutput", label: "純正出力", type: "output", order: 8 },
      { key: "stage1Gain", label: "Stage1&1.5最大出力", labelHtml: "Stage1&amp;1.5<br>最大出力", type: "output", order: 9 },
      { key: "shops", label: "対応店舗", type: "shops", order: 10 },
      { key: "remote", label: "リモート", type: "remote", order: 11 },
    ],
    jsonLdDescription:
      "Mercedes-Benz全車種(A/B/C/E/S/CLA/CLS/GLA/GLB/GLC/GLE/GLS/G/SL/SLK/AMG GT等)対応のECUチューニング・バブリング施工サービス。M139・M177・M256など全エンジン対応。",
  },
  {
    id: "mercedes_diesel",
    file: "mercedes_diesel_price_table.html",
    displayName: "Mercedes(ディーゼル)",
    slug: "mercedes-diesel",
    namespacePrefix: "mbd-",
    ns: "mbd-",
    searchAttr: "data-mbd-search",
    seriesAttr: "data-mbd-series",
    hasGrade: true,
    hasEngine: true,
    priceCells: [
      { key: "ecuTuning", cls: "mbd-cell-price-stage1", label: "ECUチューニング" },
      { key: "adblueCut", cls: "mbd-cell-price-adblue", label: "アドブルーカット" },
      { key: "ecuAdblue", cls: "mbd-cell-price-ecuadblue", label: "ECU+アドブルー" },
      { key: "dpfEgrNox", cls: "mbd-cell-price-dpf", label: "DPF/EGR/NOxカット" },
    ],
    columns: [
      { key: "car", label: "車種 (型式)", type: "text", order: 0 },
      { key: "grade", label: "グレード", type: "text", order: 1 },
      { key: "engine", label: "エンジン", type: "text", order: 2 },
      { key: "ecuTuning", label: "ECUチューニング", labelHtml: "ECU<br>チューニング", type: "price", emphasis: "primary", emptyBehavior: "line-btn", order: 3 },
      { key: "adblueCut", label: "アドブルーカット", labelHtml: "アドブルー<br>カット", type: "price", emphasis: "primary", emptyBehavior: "line-btn", order: 4 },
      { key: "ecuAdblue", label: "ECU+アドブルー", labelHtml: "ECU+<br>アドブルー", type: "price", emphasis: "secondary", emptyBehavior: "line-btn", order: 5 },
      { key: "dpfEgrNox", label: "DPF/EGR/NOxカット", labelHtml: "DPF/EGR<br>/NOxカット", type: "price", emphasis: "secondary", emptyBehavior: "line-btn", order: 6 },
      { key: "labor", label: "脱着・殻割工賃", labelHtml: "脱着・殻割<br>工賃", type: "labor", order: 7 },
      { key: "stockOutput", label: "純正出力", type: "output", order: 8 },
      { key: "stage1Gain", label: "Stage1最大出力", labelHtml: "Stage1<br>最大出力", type: "output", order: 9 },
      { key: "shops", label: "対応店舗", type: "shops", order: 10 },
      { key: "remote", label: "リモート", type: "remote", order: 11 },
    ],
    jsonLdDescription:
      "Mercedes-Benzディーゼル車(OM642・OM651・OM654・OM656)対応のECUチューニング・AdBlue/DPF/EGR/NOxカット施工サービス。",
  },
  {
    id: "audi",
    file: "audi_price_table.html",
    displayName: "Audi",
    slug: "audi",
    namespacePrefix: "audi-",
    ns: "audi-",
    searchAttr: "data-audi-search",
    seriesAttr: "data-audi-series",
    hasGrade: false,
    hasEngine: true,
    priceCells: [
      { key: "babble", cls: "audi-cell-price-babble", label: "バブリング" },
      { key: "stage1", cls: "audi-cell-price-stage1", label: "Stage1" },
      { key: "stage2", cls: "audi-cell-price-stage2", label: "Stage2" },
      { key: "tcu", cls: "audi-cell-tcu", label: "TCUチューニング" },
    ],
    columns: [
      { key: "car", label: "車種 (型式)", type: "text", order: 0 },
      { key: "engine", label: "エンジン", type: "text", order: 1 },
      { key: "babble", label: "バブリングのみ", labelHtml: "バブリング<br>のみ", type: "price", emphasis: "primary", emptyBehavior: "line-btn", order: 2 },
      { key: "stage1", label: "Stage1(バブ無料)", labelHtml: "Stage1<br><small>(バブ無料)</small>", type: "price", emphasis: "primary", emptyBehavior: "line-btn", order: 3 },
      { key: "stage2", label: "Stage2", type: "price", emphasis: "secondary", emptyBehavior: "line-btn", order: 4 },
      { key: "tcu", label: "TCUチューニング", labelHtml: "TCU<br>チューニング", type: "price", emphasis: "secondary", emptyBehavior: "line-btn", order: 5 },
      { key: "stockOutput", label: "純正出力", type: "output", order: 6 },
      { key: "stage1Gain", label: "Stage1出力向上", labelHtml: "Stage1<br>出力向上", type: "output", order: 7 },
      { key: "shops", label: "対応店舗", type: "shops", order: 8 },
      { key: "remote", label: "リモート", type: "remote", order: 9 },
      { key: "ecuType", label: "ECU/TCU型番", labelHtml: "ECU/TCU<br>型番", type: "ecu", order: 10 },
    ],
    jsonLdDescription:
      "Audi全車種(A1〜A8・Q2〜Q8・TT・R8・S/RSモデル)対応のECUチューニング・バブリング・TCUチューニング施工サービス。",
  },
  {
    id: "lamborghini",
    file: "lamborghini_price_table.html",
    displayName: "Lamborghini",
    slug: "lamborghini",
    namespacePrefix: "lambo-",
    ns: "",
    searchAttr: "data-search",
    seriesAttr: "data-series",
    hasGrade: true,
    hasEngine: false,
    priceCells: [
      { key: "babble", cls: "cell-price-babble", label: "バブリング" },
      { key: "ecuTuning", cls: "cell-price-stage1", label: "ECUチューニング" },
      { key: "tcu", cls: "cell-tcu", label: "TCUチューニング" },
    ],
    columns: [
      { key: "car", label: "車種", type: "text", order: 0 },
      { key: "grade", label: "グレード", type: "text", order: 1 },
      { key: "babble", label: "バブリングのみ", labelHtml: "バブリング<br>のみ", type: "price", emphasis: "primary", emptyBehavior: "line-btn", order: 2 },
      { key: "ecuTuning", label: "ECUチューニング(バブ無料)", labelHtml: "ECUチューニング<br><small>(バブ無料)</small>", type: "price", emphasis: "primary", emptyBehavior: "line-btn", order: 3 },
      { key: "tcu", label: "TCUチューニング", labelHtml: "TCU<br>チューニング", type: "price", emphasis: "secondary", emptyBehavior: "line-btn", order: 4 },
      { key: "stockOutput", label: "純正出力", type: "output", order: 5 },
      { key: "stage1Gain", label: "Stage1出力向上", labelHtml: "Stage1<br>出力向上", type: "output", order: 6 },
      { key: "labor", label: "工賃", type: "labor", order: 7 },
      { key: "shops", label: "取扱店", type: "shops", order: 8 },
      { key: "remote", label: "リモート", type: "remote", order: 9 },
      { key: "ecuType", label: "ECU/TCU型番", labelHtml: "ECU/TCU<br>型番", type: "ecu", order: 10 },
    ],
    jsonLdDescription:
      "Lamborghini全車種(Aventador・Huracan・Urus・Revuelto)対応のECUチューニング・バブリング・TCUチューニング施工サービス。",
  },
];

// ── HTML ユーティリティ ──
const stripTags = (s: string) => s.replace(/<[^>]+>/g, "").trim();
function decode(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

// セルの中身 → 保存値。LINEボタン/「—」は空、価格は数字だけにする。
function cellValue(html: string): string | null {
  if (/ask-btn/.test(html)) return null; // LINEボタン = 未設定
  const text = decode(stripTags(html));
  if (!text || text === "—" || text === "-") return null;
  return text;
}
// 価格セル: "¥165,000" → "165000" / "ASK" はそのまま
function priceValue(html: string): string | null {
  const v = cellValue(html);
  if (v == null) return null;
  if (/^ASK$/i.test(v)) return "ASK";
  const m = v.replace(/[¥,\s]/g, "");
  return /^\d+$/.test(m) ? m : v;
}
// リモート: バッジのtitle属性から4フラグを復元
function remoteValue(html: string) {
  const titles = [...html.matchAll(/badge-remote"[^>]*title="([^"]*)"/g)].map((m) => m[1]);
  const t = titles.join("|");
  return {
    autoTuner: /AutoTuner(?!\s*One)/.test(t),
    powerGate3: /Powergate3/i.test(t),
    flasher: /Flasher/i.test(t),
    atOne: /AutoTuner\s*One|AT1/i.test(t),
  };
}

type Row = {
  seriesGroup: string;
  carName: string;
  grade: string | null;
  engine: string;
  engineFamily: string | null;
  ecuType: string | null;
  stockOutput: string | null;
  stage1Gain: string | null;
  prices: Record<string, string>;
  labor: string | null;
  shops: string | null;
  remote: Record<string, boolean>;
  notes: string | null;
};

function parseBrand(html: string, b: BrandSpec): { rows: Row[]; seriesGroups: string[]; intro: string } {
  const ns = b.ns;
  const rowRe = new RegExp(`<tr [^>]*${b.searchAttr}="[^"]*"[^>]*>([\\s\\S]*?)</tr>`, "g");
  const seriesRe = new RegExp(`${b.seriesAttr}="([^"]*)"`);
  const rows: Row[] = [];
  const seriesSet = new Set<string>();

  for (const m of html.matchAll(rowRe)) {
    const trTag = m[0].slice(0, m[0].indexOf(">") + 1);
    const body = m[1];
    const series = seriesRe.exec(trTag)?.[1] ?? "";
    seriesSet.add(series);

    const cell = (cls: string): string | null => {
      const re = new RegExp(`<td class="${cls}"[^>]*>([\\s\\S]*?)</td>`);
      const r = re.exec(body);
      return r ? r[1] : null;
    };

    const carHtml = cell(`${ns}cell-car`) ?? "";
    const gradeHtml = cell(`${ns}cell-grade`) ?? "";
    // 備考(★)は <span class="(ns)cell-note" title="…">★</span> の title に入る
    const noteM = /class="[^"]*cell-note[^"]*"[^>]*title="([^"]*)"/.exec(carHtml + gradeHtml);

    const engineHtml = cell(`${ns}cell-engine`) ?? "";
    const famM = /badge-engine">([^<]*)</.exec(engineHtml);
    const engineText = decode(stripTags(engineHtml.replace(/<span class="[^"]*badge-engine[^"]*">[^<]*<\/span>/, "")));

    const prices: Record<string, string> = {};
    for (const pc of b.priceCells) {
      const v = priceValue(cell(pc.cls) ?? "");
      if (v != null) prices[pc.key] = v;
    }

    rows.push({
      seriesGroup: series,
      carName: decode(stripTags(carHtml)).replace(/★/g, "").trim(),
      grade: b.hasGrade ? cellValue(cell(`${ns}cell-grade`) ?? "")?.replace(/★/g, "").trim() ?? null : null,
      engine: b.hasEngine ? engineText : "",
      engineFamily: famM ? decode(famM[1]) : null,
      ecuType: cellValue(cell(`${ns}cell-ecu-tcu`) ?? ""),
      stockOutput: cellValue(cell(`${ns}cell-stock`) ?? ""),
      stage1Gain: cellValue(cell(`${ns}cell-stage1-gain`) ?? ""),
      prices,
      labor: cellValue(cell(`${ns}cell-labor`) ?? ""),
      shops: cellValue(cell(`${ns}cell-shops`) ?? ""),
      remote: remoteValue(cell(`${ns}cell-remote`) ?? ""),
      notes: noteM ? decode(noteM[1]) : null,
    });
  }

  // フィルタチップの順序を正とする（HTMLの並び）
  const chipRe = new RegExp(`data-filter-series="([^"]*)"`, "g");
  const chips = [...html.matchAll(chipRe)].map((m) => m[1]).filter((v) => v !== "all");
  const seriesGroups = chips.length > 0 ? chips : [...seriesSet].filter(Boolean);

  const introM = new RegExp(`<div class="${b.namespacePrefix}intro">\\s*<p>([\\s\\S]*?)</p>`).exec(html);
  return { rows, seriesGroups, intro: introM ? introM[1].trim() : "" };
}

// ── 実行 ──
const dir = process.argv[2];
if (!dir) {
  console.error("usage: tsx scripts/import-price-html.mts <htmlディレクトリ>");
  process.exit(1);
}
const url = (readFileSync(new URL("../.env", import.meta.url), "utf8").match(/DATABASE_URL="([^"]+)"/) || [])[1];
if (!url) throw new Error("DATABASE_URL が読めません");

const client = new Client({ connectionString: url });
await client.connect();

let total = 0;
for (const b of BRANDS) {
  const html = readFileSync(join(dir, b.file), "utf8");
  const { rows, seriesGroups, intro } = parseBrand(html, b);

  await client.query(
    `INSERT INTO "PriceBrand" (id,"displayName",slug,"namespacePrefix","seriesGroups",columns,"csvMapping",intro,"jsonLdDescription","displayOrder","createdAt","updatedAt")
     VALUES ($1,$2,$3,$4,$5,$6,'{}',$7,$8,$9,now(),now())
     ON CONFLICT (id) DO UPDATE SET
       "displayName"=EXCLUDED."displayName", slug=EXCLUDED.slug, "namespacePrefix"=EXCLUDED."namespacePrefix",
       "seriesGroups"=EXCLUDED."seriesGroups", columns=EXCLUDED.columns, intro=EXCLUDED.intro,
       "jsonLdDescription"=EXCLUDED."jsonLdDescription", "displayOrder"=EXCLUDED."displayOrder", "updatedAt"=now()`,
    [b.id, b.displayName, b.slug, b.namespacePrefix, seriesGroups, JSON.stringify(b.columns), intro, b.jsonLdDescription, BRANDS.indexOf(b)],
  );

  // 再取込は洗い替え（HTMLが唯一の初期データ源）
  await client.query(`DELETE FROM "PriceVehicle" WHERE "brandId"=$1`, [b.id]);
  let i = 0;
  for (const r of rows) {
    await client.query(
      `INSERT INTO "PriceVehicle"
        (id,"brandId","seriesGroup","carName",grade,engine,"engineFamily","ecuType","stockOutput","stage1Gain",prices,labor,shops,remote,notes,"displayOrder","createdAt","updatedAt")
       VALUES (gen_random_uuid()::text,$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,now(),now())`,
      [
        b.id, r.seriesGroup, r.carName, r.grade, r.engine, r.engineFamily, r.ecuType,
        r.stockOutput, r.stage1Gain, JSON.stringify(r.prices), r.labor, r.shops,
        JSON.stringify(r.remote), r.notes, i++,
      ],
    );
  }
  total += rows.length;
  console.log(`${b.displayName.padEnd(22)} rows=${String(rows.length).padStart(3)}  series=${seriesGroups.length}`);
}
console.log(`\n合計 ${total} モデルを投入しました`);
await client.end();
