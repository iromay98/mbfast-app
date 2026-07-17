// DBの価格表データから、公開用HTML（WordPress貼り付け範囲）を生成する。
// 出力は prisma/data/reference/*.html と完全同一になることを scripts/verify-price-html.mts で保証する。

import { PRICE_HTML_TEMPLATES } from "./templates";
import type { BrandRow, VehicleRow, RemoteFlags } from "./types";

const LINE_URL = "https://lin.ee/8yOXuPJ";

// リモートバッジの表示順とHTML上の表記
const REMOTE_BADGES: { key: keyof RemoteFlags; title: string; badge: string }[] = [
  { key: "powerGate3", title: "Powergate3", badge: "PG3" },
  { key: "flasher", title: "IXI Flasher", badge: "Flasher" },
  { key: "autoTuner", title: "AutoTuner", badge: "AT" },
  { key: "atOne", title: "AT One", badge: "AT1" },
];

type SearchPart = "car" | "grade" | "engine" | "family" | "ecu" | "carSplit";

// セル並びの宣言。key は VehicleRow のフィールド or prices の動的キー。
type CellSpec =
  | { kind: "car" }
  | { kind: "grade" }
  | { kind: "engine" }
  | { kind: "price"; key: string; askLabel: string; emptyDashIfPrimary?: boolean }
  | { kind: "labor" }
  | { kind: "stock" }
  | { kind: "gain" }
  | { kind: "shops" }
  | { kind: "remote" }
  | { kind: "ecu" };

type BrandHtmlSpec = {
  ns: string; // クラス接頭辞 "" | "audi-" | "mbd-"
  searchAttr: string;
  seriesAttr: string;
  engineFamilyAttr: boolean; // trに data-engine-family を出す（Mercedesガソリンのみ）
  askHasGrade: boolean; // ask-btn に data-grade を含める
  searchParts: SearchPart[];
  cells: CellSpec[];
};

export const BRAND_HTML_SPECS: Record<string, BrandHtmlSpec> = {
  bmw: {
    ns: "",
    searchAttr: "data-search",
    seriesAttr: "data-series",
    engineFamilyAttr: false,
    askHasGrade: true,
    searchParts: ["car", "grade", "engine", "family", "ecu", "carSplit"],
    cells: [
      { kind: "car" },
      { kind: "grade" },
      { kind: "engine" },
      { kind: "price", key: "babble", askLabel: "バブリング" },
      { kind: "price", key: "stage1", askLabel: "ECUチューニング" },
      { kind: "labor" },
      { kind: "stock" },
      { kind: "gain" },
      { kind: "remote" },
      { kind: "ecu" },
    ],
  },
  mercedes_gasoline: {
    ns: "",
    searchAttr: "data-search",
    seriesAttr: "data-series",
    engineFamilyAttr: true,
    askHasGrade: true,
    searchParts: ["car", "grade", "engine", "family", "carSplit"],
    cells: [
      { kind: "car" },
      { kind: "grade" },
      { kind: "engine" },
      { kind: "price", key: "babble", askLabel: "バブリング" },
      { kind: "price", key: "stage1", askLabel: "Stage1" },
      { kind: "price", key: "stage15", askLabel: "Stage1.5", emptyDashIfPrimary: true },
      { kind: "price", key: "stage2", askLabel: "Stage2", emptyDashIfPrimary: true },
      { kind: "labor" },
      { kind: "stock" },
      { kind: "gain" },
      { kind: "shops" },
      { kind: "remote" },
    ],
  },
  mercedes_diesel: {
    ns: "mbd-",
    searchAttr: "data-mbd-search",
    seriesAttr: "data-mbd-series",
    engineFamilyAttr: false,
    askHasGrade: true,
    searchParts: ["car", "grade", "engine", "family", "carSplit"],
    cells: [
      { kind: "car" },
      { kind: "grade" },
      { kind: "engine" },
      { kind: "price", key: "ecuTuning", askLabel: "ECUチューニング" },
      { kind: "price", key: "adblueCut", askLabel: "アドブルーカット" },
      { kind: "price", key: "ecuAdblue", askLabel: "ECU+アドブルー" },
      { kind: "price", key: "dpfEgrNox", askLabel: "DPF/EGR/NOxカット" },
      { kind: "labor" },
      { kind: "stock" },
      { kind: "gain" },
      { kind: "shops" },
      { kind: "remote" },
    ],
  },
  audi: {
    ns: "audi-",
    searchAttr: "data-audi-search",
    seriesAttr: "data-audi-series",
    engineFamilyAttr: false,
    askHasGrade: false,
    searchParts: ["car", "engine", "family", "carSplit", "ecu"],
    cells: [
      { kind: "car" },
      { kind: "engine" },
      { kind: "price", key: "babble", askLabel: "バブリング" },
      { kind: "price", key: "stage1", askLabel: "Stage1" },
      { kind: "price", key: "stage2", askLabel: "Stage2" },
      { kind: "price", key: "tcu", askLabel: "TCUチューニング" },
      { kind: "stock" },
      { kind: "gain" },
      { kind: "shops" },
      { kind: "remote" },
      { kind: "ecu" },
    ],
  },
  lamborghini: {
    ns: "",
    searchAttr: "data-search",
    seriesAttr: "data-series",
    engineFamilyAttr: false,
    askHasGrade: true,
    searchParts: ["car", "grade", "ecu", "carSplit"],
    cells: [
      { kind: "car" },
      { kind: "grade" },
      { kind: "price", key: "babble", askLabel: "バブリング" },
      { kind: "price", key: "ecuTuning", askLabel: "ECUチューニング" },
      { kind: "price", key: "tcu", askLabel: "TCUチューニング" },
      { kind: "stock" },
      { kind: "gain" },
      { kind: "labor" },
      { kind: "shops" },
      { kind: "remote" },
      { kind: "ecu" },
    ],
  },
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// 価格の保存値 → 表示。数字のみは ¥+カンマ区切り、それ以外（"+¥33,000/各" 等）はそのまま。
function priceText(v: string): string {
  return /^\d+$/.test(v) ? `¥${Number(v).toLocaleString("en-US")}` : v;
}

// dataLabel は data-label 属性、titleText は「【…】」内（例: 価格は「Stage1見積希望」、工賃は「工賃見積希望」）
function askBtn(ns: string, v: VehicleRow, dataLabel: string, titleText: string, withGrade: boolean): string {
  const target = withGrade && v.grade ? `${v.carName} ${v.grade}` : v.carName;
  const gradeAttr = withGrade ? ` data-grade="${esc(v.grade ?? "")}"` : "";
  return (
    `<a href="${LINE_URL}" target="_blank" rel="noopener" class="${ns}ask-btn"` +
    ` data-car="${esc(v.carName)}"${gradeAttr} data-label="${esc(dataLabel)}"` +
    ` title="LINEで問い合わせ:【${titleText}】${esc(target)}">` +
    `<span class="${ns}ask-icon">💬</span><span class="${ns}ask-text">LINE</span></a>`
  );
}

const dash = (ns: string) => `<span class="${ns}muted">—</span>`;

// 主要価格（バブリング/Stage1）が入っているか。Stage1.5/2 の空欄表示の分岐に使う。
const PRIMARY_PRICE_KEYS: Record<string, string[]> = {
  mercedes_gasoline: ["babble", "stage1"],
};
function hasPrimaryPrice(brandId: string, v: VehicleRow): boolean {
  return (PRIMARY_PRICE_KEYS[brandId] ?? []).some((k) => v.prices[k] != null);
}

function noteStar(ns: string, note: string): string {
  return ` <span class="${ns}cell-note" title="${esc(note)}">★</span>`;
}

function remoteCell(ns: string, flags: RemoteFlags): string {
  const badges = REMOTE_BADGES.filter((b) => flags[b.key]);
  if (badges.length === 0) return dash(ns);
  return badges
    .map((b) => `<span class="${ns}badge ${ns}badge-remote" title="${b.title}">${b.badge}</span>`)
    .join("");
}

function searchValue(parts: SearchPart[], v: VehicleRow): string {
  const vals: string[] = [];
  for (const p of parts) {
    switch (p) {
      case "car":
        vals.push(v.carName);
        break;
      case "grade":
        if (v.grade) vals.push(v.grade);
        break;
      case "engine":
        if (v.engine) vals.push(v.engine);
        break;
      case "family":
        if (v.engineFamily) vals.push(v.engineFamily);
        break;
      case "ecu":
        if (v.ecuType) vals.push(v.ecuType);
        break;
      case "carSplit": {
        // 末尾は「シリーズ名＋括弧内の型式」（"A(W168)"×series"A" → "a w168"、"CLK-Class"×"CLK" → "clk"）
        const paren = /\(([^)]*)\)/.exec(v.carName)?.[1];
        vals.push(paren ? `${v.seriesGroup} ${paren}` : v.seriesGroup);
        break;
      }
    }
  }
  return vals.join(" ").toLowerCase();
}

export function renderRow(brandId: string, v: VehicleRow): string {
  const spec = BRAND_HTML_SPECS[brandId];
  if (!spec) throw new Error(`未対応ブランド: ${brandId}`);
  const ns = spec.ns;

  const attrs = [
    `${spec.searchAttr}="${esc(searchValue(spec.searchParts, v))}"`,
    // Mercedesガソリンは family 無しでも空属性を出す（元HTMLの仕様）
    ...(spec.engineFamilyAttr ? [`data-engine-family="${esc(v.engineFamily ?? "")}"`] : []),
    `${spec.seriesAttr}="${esc(v.seriesGroup)}"`,
  ].join(" ");

  const tds = spec.cells.map((c) => {
    switch (c.kind) {
      case "car": {
        // グレード列が無いブランドでは ★ を車種セルに付ける
        const star = !spec.cells.some((x) => x.kind === "grade") && v.notes ? noteStar(ns, v.notes) : "";
        return `<td class="${ns}cell-car"><strong>${esc(v.carName)}</strong>${star}</td>`;
      }
      case "grade": {
        const star = v.notes ? noteStar(ns, v.notes) : "";
        const body = v.grade ? esc(v.grade) + star : "";
        return `<td class="${ns}cell-grade">${body}</td>`;
      }
      case "engine": {
        // 元HTMLは常に「エンジン名＋半角スペース＋(バッジ)」。バッジ無し・空でもスペースが残る。
        const fam = v.engineFamily
          ? `<span class="${ns}badge ${ns}badge-engine">${esc(v.engineFamily)}</span>`
          : "";
        return `<td class="${ns}cell-engine">${esc(v.engine)} ${fam}</td>`;
      }
      case "price": {
        const raw = v.prices[c.key];
        const cls = c.key === "tcu" ? `${ns}cell-tcu` : priceCellClass(brandId, ns, c.key);
        let body: string;
        if (raw != null) {
          body = esc(priceText(raw));
        } else if (c.emptyDashIfPrimary && hasPrimaryPrice(brandId, v)) {
          // 主要価格があるのに未設定 = 提供無し → ダッシュ表示
          body = dash(ns);
        } else {
          body = askBtn(ns, v, c.askLabel, `${c.askLabel}見積希望`, spec.askHasGrade);
        }
        return `<td class="${cls}">${body}</td>`;
      }
      case "labor": {
        // 規約: null = LINEボタン / "—" = ダッシュ / それ以外 = テキスト
        const body =
          v.labor === "—"
            ? dash(ns)
            : v.labor
              ? esc(v.labor)
              : askBtn(ns, v, "工賃見積", "工賃見積希望", spec.askHasGrade);
        return `<td class="${ns}cell-labor">${body}</td>`;
      }
      case "stock":
        return `<td class="${ns}cell-stock">${v.stockOutput ? esc(v.stockOutput) : dash(ns)}</td>`;
      case "gain":
        return `<td class="${ns}cell-stage1-gain">${v.stage1Gain ? esc(v.stage1Gain) : dash(ns)}</td>`;
      case "shops":
        return `<td class="${ns}cell-shops">${v.shops ? esc(v.shops) : dash(ns)}</td>`;
      case "remote":
        return `<td class="${ns}cell-remote">${remoteCell(ns, v.remote)}</td>`;
      case "ecu":
        return `<td class="${ns}cell-ecu-tcu">${v.ecuType ? esc(v.ecuType) : dash(ns)}</td>`;
    }
  });

  return `<tr ${attrs}>\n` + tds.map((t) => `    ${t}`).join("\n") + `\n  </tr>`;
}

// 価格セルのクラス名（keyとクラスの対応はブランドで異なる）
function priceCellClass(brandId: string, ns: string, key: string): string {
  const map: Record<string, Record<string, string>> = {
    bmw: { babble: "cell-price-babble", stage1: "cell-price-stage1" },
    mercedes_gasoline: {
      babble: "cell-price-babble",
      stage1: "cell-price-stage1",
      stage15: "cell-price-stage15",
      stage2: "cell-price-stage2",
    },
    mercedes_diesel: {
      ecuTuning: "mbd-cell-price-stage1",
      adblueCut: "mbd-cell-price-adblue",
      ecuAdblue: "mbd-cell-price-ecuadblue",
      dpfEgrNox: "mbd-cell-price-dpf",
    },
    audi: {
      babble: "audi-cell-price-babble",
      stage1: "audi-cell-price-stage1",
      stage2: "audi-cell-price-stage2",
    },
    lamborghini: { babble: "cell-price-babble", ecuTuning: "cell-price-stage1" },
  };
  return map[brandId]?.[key] ?? `${ns}cell-price-${key}`;
}

export function generatePriceTableHtml(brand: BrandRow, vehicles: VehicleRow[]): string {
  const tpl = PRICE_HTML_TEMPLATES[brand.id];
  if (!tpl) throw new Error(`テンプレート未登録: ${brand.id}`);

  const chips = brand.seriesGroups.map((s) => tpl.chip.replace(/\{\{S\}\}/g, s)).join("\n");
  const head = tpl.head
    .replace("{{JSONLD_DESCRIPTION}}", brand.jsonLdDescription)
    .replace("{{INTRO}}", brand.intro)
    .replace("{{FILTER_CHIPS}}", chips)
    .replace(/\{\{TOTAL\}\}/g, String(vehicles.length));

  const rows = vehicles.map((v) => renderRow(brand.id, v)).join("\n");
  return head + rows + "\n" + tpl.foot;
}
