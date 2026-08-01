/*
 * Step A: フィクスチャHTML → parse → PriceBrand / PriceVehicle[] の upsert ペイロード構築。
 *
 *   モード:
 *     --dry-run（既定・DB非書き込み）: ペイロードを構築し、**そのペイロードから生成HTMLを
 *        作ってフィクスチャと差分**を出す（＝DBモデルに載せても情報が落ちないことの証明）。
 *        ブランド別に「行数・全フィールドのマッピング・生成差分」を報告。
 *     --pilot: lambo/ferrari/mbd/others の4本だけ。
 *     --commit（本番用・今回は実行しない）: prisma で upsert。先頭で「バックアップ済み確認」
 *        フラグ(--i-have-backed-up)と DATABASE_URL を要求するガードを入れる。
 *
 *   退避（--commit 前に本番VPSで人手で実行。ここでは実行しない）:
 *     docker compose -f /root/mbfast-app/docker-compose.prod.yml exec -T postgres \
 *       pg_dump -U mbfast -d mbfast -t '"PriceBrand"' -t '"PriceVehicle"' \
 *       > pricebackup_$(date +%Y%m%d%H%M).sql
 *
 *   losslessness の作り: 各行のセルを **意味フィールドから再構成**（car/grade/engine/maker/
 *   価格/工賃/出力/店舗/リモート/ECU）。備考★は layout.askStarColumns のブランド規則＋
 *   PriceVehicle.notes（ノート有無）から再現。<tr> の data-{p}-search は派生インデックス
 *   （意味データではない）ため実測値を持ち回る（レポートで明示）。
 *
 *   ── Step A' 予定（ゼロ差分の前提を崩すため Step A では入れない・Claude Home判断2/3） ──
 *   ② lexus の裸「0」→ ¥0 正規化。Step A は裸 0 のまま通す。A' で正規化する際は
 *      (a) 0 を falsy 判定で空欄扱い→LINEボタン化しない（0 と null を明確に区別）、
 *      (b) 「工賃0円」か「工賃概念なし(—/not_offered)」かを lexus 実データで判断、を守る。
 *   ③ data-{p}-search は A では実測値を持ち回る。A' で layout.searchIndexRule
 *      （例 ["car","grade","engine","engineFamily","series","generation"]）から規則生成に切替。
 *      主要検索語（車種名・型式・エンジン型番）がヒットするテストを A' に含める。
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discoverTables, loadFixture, parseWpBlock, extractBlock, PILOTS } from "./parse-wp.mts";
import { buildRegionsFromParsed } from "../../src/lib/prices/generated-template";
import type {
  BrandLayout,
  CellCell,
  CellValue,
  ParsedBlock,
  ParsedColumn,
  ParsedRow,
} from "../../src/lib/prices/generated-template";
import { REMOTE_TOOLS, type RemoteFlags } from "../../src/lib/prices/types";

// ── brand id 方針（Claude Home判断: 案B確定 = 全ブランド prefix を id にする） ──
// 「後で移行」はしない。取込前に旧idを削除して prefix で作り直す。
//   理由: prefix と id が乖離すると CSS名前空間 / data属性 / 要素ID / brand_layout 参照が
//   全て「1段の間接参照」経由になる。7/31に data-{p}-series と data-{p}-filter-series の
//   取り違えで27ブランド全滅した事故と同じ構図。間接層は増やさない。
//   prefix は生成HTMLに物理的に埋まる（bmw-cell-car / data-bmw-search / bmwTableBody）ので、
//   「HTMLが正」ならDBのキーもHTMLの値（=prefix）に合わせるのが筋。
//
// 現DBは Airtable由来の5行で、7/31改修（Stage2/TCU新設・列順変更・iframe→HTML化）が未反映。
// 移行する価値のあるデータを持たないため、取込前に丸ごと削除する（人手のpg_dump退避が前提）。
// ここに載る5つが「削除対象の旧id」。うち lambo/mb/mbd は prefix と乖離、audi/bmw は同名。
const LEGACY_BRAND_IDS = ["lamborghini", "mercedes_gasoline", "mercedes_diesel", "audi", "bmw"];
// prefix → 旧id（レポートで「この旧行を消して prefix で作り直す」ことを明示するためだけに使う）。
const PREFIX_TO_LEGACY_ID: Record<string, string> = {
  lambo: "lamborghini",
  mb: "mercedes_gasoline",
  mbd: "mercedes_diesel",
  audi: "audi",
  bmw: "bmw",
};

// ── ペイロード型（Prisma upsert と同形） ─────────────────────────
type BrandPayload = {
  id: string; // 既定=prefix（要人間レビュー・PREFIX_TO_EXISTING_ID 参照）
  slug: string;
  displayName: string;
  namespacePrefix: string; // "lambo-"（DB慣習に合わせ末尾ダッシュ）
  seriesGroups: string[];
  columns: unknown[]; // ColumnDefinition[] 互換＋parse拡張（Json）
  intro: string;
  jsonLdDescription: string;
  wordPressPageId: number;
  blockIndex: number;
  layout: BrandLayout;
  displayOrder: number;
};
type VehiclePayload = {
  market: "JP";
  source: "html";
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
  remote: RemoteFlags;
  notes: string | null;
  displayOrder: number;
  // 非意味データ（派生）: data-search を持ち回るための退避（レポートで明示）
  _searchIndex: string;
  _extraTrAttrs: { name: string; value: string }[]; // engine-family 等（search/series 以外）
};

// ── 小道具 ───────────────────────────────────────────────────────
const stripTags = (s: string) => s.replace(/<[^>]+>/g, "").trim();
const isMuted = (html: string) => /-muted"[^>]*>\s*—\s*</.test(html) || html.trim() === "—";
const priceKeyOf = (suffix: string) =>
  suffix.startsWith("cell-price-") ? suffix.slice("cell-price-".length) : suffix === "cell-tcu" ? "tcu" : suffix;

// remote バッジの実測表現（ブランドで title の文言が違う: 例 mb は AT1 の title="AT One"）。
// バッジ文字（PG3/Flasher/AT/AT1）でツールを同定し、title は実測値を保持して再現する。
type RemoteInfo = Map<keyof RemoteFlags, { badge: string; title: string }>;
function buildRemoteInfo(pb: ParsedBlock): RemoteInfo {
  const info: RemoteInfo = new Map();
  const ri = pb.columns.findIndex((c) => c.cellClassSuffix === "cell-remote");
  if (ri < 0) return info;
  for (const row of pb.rows) {
    const cell = row.cells[ri];
    if (cell.role !== "verbatim") continue;
    for (const m of cell.innerHtml.matchAll(/badge-remote"[^>]*title="([^"]*)"[^>]*>\s*([^<]+?)\s*<\/span>/g)) {
      const title = m[1];
      const badge = m[2].trim();
      const tool = REMOTE_TOOLS.find((t) => t.badge === badge);
      if (tool && !info.has(tool.key)) info.set(tool.key, { badge, title });
    }
  }
  return info;
}

// ブランドの構造フラグ（意味モデルでの再現に必要）。
type BrandFlags = {
  engineHasBadge: boolean; // エンジンセルが engineFamily を badge 表示するか（mbd/mb=true, vw=false）
  askHasDataGrade: boolean; // grade列が無いのに ask-btn が data-grade を持つか（vw=true）
};
function brandFlags(pb: ParsedBlock): BrandFlags {
  const ei = pb.columns.findIndex((c) => c.role === "engine");
  const engineHasBadge =
    ei >= 0 &&
    pb.rows.some((r) => {
      const c = r.cells[ei];
      return c.role === "verbatim" && /badge-engine/.test(c.innerHtml);
    });
  const askHasDataGrade =
    !pb.layout.hasGradeColumn &&
    pb.rows.some((r) => r.cells.some((c) => c.role === "value" && c.value.kind === "ask" && c.value.askGrade !== undefined));
  return { engineHasBadge, askHasDataGrade };
}

// ── 抽出: ParsedBlock → 意味フィールド ──────────────────────────
function extractVehicles(pb: ParsedBlock, remoteInfo: RemoteInfo, flags: BrandFlags): VehiclePayload[] {
  const p = pb.layout.namespacePrefix;
  const cols = pb.columns;
  const idx = (role: ParsedColumn["role"]) => cols.findIndex((c) => c.role === role);
  const carI = idx("car");
  const gradeI = idx("grade");
  const engineI = idx("engine");
  const makerI = idx("maker");
  const nameI = pb.layout.hasGradeColumn ? gradeI : carI;

  return pb.rows.map((row, r) => {
    const cellHtml = (i: number) => {
      const c = i >= 0 ? row.cells[i] : undefined;
      return c && c.role === "verbatim" ? c.innerHtml : "";
    };
    const carName = carI >= 0 ? stripTags(/(<strong>[\s\S]*?<\/strong>)/.exec(cellHtml(carI))?.[1] ?? cellHtml(carI)) : "";
    const gradeRaw = gradeI >= 0 ? cellHtml(gradeI) : "";
    const grade = gradeI >= 0 ? stripTags(gradeRaw.replace(/<span[^>]*cell-note[\s\S]*?<\/span>/g, "")) : null;
    const engineRaw = engineI >= 0 ? cellHtml(engineI) : "";
    const engine = engineI >= 0 ? stripTags(engineRaw.replace(/<span[^>]*badge[\s\S]*?<\/span>/g, "")) : "";
    const engineBadge = /badge-engine[^>]*>([\s\S]*?)<\/span>/.exec(engineRaw)?.[1];
    const engineFamilyAttr = row.dataAttrs.find((a) => a.name === `data-${p}-engine-family`)?.value;
    // vw 型: grade列が無く engine badge も無いが ask-btn が data-grade（エンジンコード）を持つ。
    // そのコードを engineFamily に格納（engine セルには badge を出さない＝engineHasBadge=false）。
    const askCode = flags.askHasDataGrade
      ? row.cells.find((c) => c.role === "value" && c.value.kind === "ask" && c.value.askGrade !== undefined)
      : undefined;
    const askCodeVal =
      askCode && askCode.role === "value" && askCode.value.kind === "ask" ? askCode.value.askGrade : undefined;
    const engineFamily = (engineBadge ? stripTags(engineBadge) : engineFamilyAttr ?? askCodeVal) ?? null;
    const maker = makerI >= 0 ? stripTags(cellHtml(makerI)) : "";

    // 備考（ノート）は名前セル（grade or car）の cell-note title
    const nameHtml = nameI >= 0 ? cellHtml(nameI) : "";
    const notes = /cell-note"[^>]*title="([^"]*)"/.exec(nameHtml)?.[1] ?? null;

    // text 系（空→null）
    const textField = (role: ParsedColumn["role"]) => {
      const i = idx(role);
      if (i < 0) return null;
      const h = cellHtml(i);
      return isMuted(h) || stripTags(h) === "" ? null : stripTags(h);
    };
    const stockOutput = cellBySuffix(pb, row, "cell-stock");
    const stage1Gain = cellBySuffix(pb, row, "cell-stage1-gain");
    const shops = cellBySuffix(pb, row, "cell-shops");
    const ecuType = cellBySuffix(pb, row, "cell-ecu-tcu");
    void textField;

    // 価格系（price/tcu）→ prices マップ、labor → labor
    const prices: Record<string, string> = {};
    let labor: string | null = null;
    cols.forEach((c, i) => {
      const cell = row.cells[i];
      if (cell.role !== "value") return;
      const enc = encodeValue(cell.value);
      if (c.role === "labor") labor = enc;
      else if (c.role === "price" || c.role === "tcu") prices[priceKeyOf(c.cellClassSuffix)] = enc;
    });

    // remote フラグ
    const remoteI = cols.findIndex((c) => c.cellClassSuffix === "cell-remote");
    const remote: RemoteFlags = {};
    if (remoteI >= 0) {
      const h = cellHtml(remoteI);
      // バッジ文字で同定（title 文言はブランド差があるため使わない）
      for (const t of REMOTE_TOOLS)
        if (new RegExp(`badge-remote"[^>]*>\\s*${t.badge.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*</span>`).test(h))
          remote[t.key] = true;
    }
    void remoteInfo;

    const _extraTrAttrs = row.dataAttrs.filter(
      (a) => a.name !== `data-${p}-search` && a.name !== `data-${p}-series`,
    );

    return {
      market: "JP",
      source: "html",
      seriesGroup: row.series,
      carName,
      grade,
      engine,
      engineFamily,
      ecuType,
      stockOutput,
      stage1Gain,
      prices,
      labor,
      shops,
      remote,
      notes,
      displayOrder: r,
      _searchIndex: row.searchText,
      _extraTrAttrs,
    };
  });
}

function cellBySuffix(pb: ParsedBlock, row: ParsedRow, suffix: string): string | null {
  const i = pb.columns.findIndex((c) => c.cellClassSuffix === suffix);
  if (i < 0) return null;
  const c = row.cells[i];
  const h = c && c.role === "verbatim" ? c.innerHtml : "";
  return isMuted(h) || stripTags(h) === "" ? null : stripTags(h);
}

function encodeValue(v: CellValue): string {
  switch (v.kind) {
    case "yen":
      return String(v.value);
    case "raw":
      return v.text;
    case "not_offered":
      return "—";
    case "ask":
      return "ASK";
  }
}

// ── ブランドペイロード ───────────────────────────────────────────
function buildBrandPayload(pb: ParsedBlock): BrandPayload {
  const p = pb.layout.namespacePrefix;
  const nameM = /"name":\s*"([^"]*?)(?:\s+ECU|")/.exec(pb.layout.jsonLd);
  const descM = /"description":\s*"([^"]*)"/.exec(pb.layout.jsonLd);
  const columns = pb.columns.map((c, order) => ({
    // ColumnDefinition 互換ビュー
    key: priceKeyOf(c.cellClassSuffix),
    label: stripTags(c.headerHtml.replace(/<br\s*\/?>/g, " ")),
    labelHtml: c.headerHtml,
    type: c.role,
    order,
    // parse 拡張（生成に必要・Json）
    sortKey: c.sortKey,
    cellClassSuffix: c.cellClassSuffix,
    role: c.role,
    colPrice: c.colPrice,
    sortable: c.sortable,
    askLabel: c.askLabel,
    titleLabel: c.titleLabel,
  }));
  return {
    id: p,
    slug: p,
    displayName: nameM?.[1]?.trim() ?? p,
    namespacePrefix: `${p}-`,
    seriesGroups: pb.layout.series,
    columns,
    intro: stripTags(pb.layout.introHtml),
    jsonLdDescription: descM?.[1] ?? "",
    wordPressPageId: pb.pageId,
    blockIndex: pb.blockIndex,
    layout: pb.layout,
    displayOrder: 0,
  };
}

// ── 再構成: 意味ペイロード → ParsedBlock（セルを意味フィールドから復元） ──
function reconstructBlock(pb: ParsedBlock, vehicles: VehiclePayload[], remoteInfo: RemoteInfo, flags: BrandFlags): ParsedBlock {
  const layout = pb.layout;
  const p = layout.namespacePrefix;
  const cols = pb.columns;
  const noteSpan = (notes: string | null) =>
    notes ? ` <span class="${p}-cell-note" title="${notes}">★</span>` : "";
  const muted = `<span class="${p}-muted">—</span>`;

  const rows: ParsedRow[] = vehicles.map((v) => {
    const hasNote = !!v.notes;
    const cells: CellCell[] = cols.map((c) => {
      switch (c.role) {
        case "car":
          return {
            role: "verbatim",
            innerHtml: `<strong>${v.carName}</strong>${layout.hasGradeColumn ? "" : noteSpan(v.notes)}`,
          };
        case "grade":
          return { role: "verbatim", innerHtml: `${v.grade ?? ""}${noteSpan(v.notes)}` };
        case "engine":
          return {
            role: "verbatim",
            innerHtml: `${v.engine}${flags.engineHasBadge && v.engineFamily ? ` <span class="${p}-badge ${p}-badge-engine">${v.engineFamily}</span>` : ""}`,
          };
        case "maker":
          return { role: "verbatim", innerHtml: `${vehMaker(v)}` };
        case "price":
        case "tcu":
          return { role: "value", value: decodeValue(layout, c, v, flags, v.prices[priceKeyOf(c.cellClassSuffix)]) };
        case "labor":
          return { role: "value", value: decodeValue(layout, c, v, flags, v.labor ?? undefined) };
        default: {
          // text 系: stock/gain/shops/ecu/remote
          const suf = c.cellClassSuffix;
          if (suf === "cell-remote") {
            const badges = REMOTE_TOOLS.filter((t) => v.remote[t.key]).map((t) => {
              const ri = remoteInfo.get(t.key);
              const title = ri?.title ?? t.title;
              const badge = ri?.badge ?? t.badge;
              return `<span class="${p}-badge ${p}-badge-remote" title="${title}">${badge}</span>`;
            });
            return { role: "verbatim", innerHtml: badges.length ? badges.join("") : muted };
          }
          const text =
            suf === "cell-stock"
              ? v.stockOutput
              : suf === "cell-stage1-gain"
                ? v.stage1Gain
                : suf === "cell-shops"
                  ? v.shops
                  : suf === "cell-ecu-tcu"
                    ? v.ecuType
                    : null;
          return { role: "verbatim", innerHtml: text ? text : muted };
        }
      }
    });

    // <tr> data属性: series=意味フィールド / search=派生インデックス持ち回り / その他=持ち回り
    const dataAttrs = [
      { name: `data-${p}-search`, value: v._searchIndex },
      { name: `data-${p}-series`, value: v.seriesGroup },
      ...v._extraTrAttrs.filter((a) => a.name !== `data-${p}-search` && a.name !== `data-${p}-series`),
    ];
    return { series: v.seriesGroup, searchText: v._searchIndex, dataAttrs, cells };
  });

  return { pageId: pb.pageId, blockIndex: pb.blockIndex, layout, columns: cols, rows };
}

function vehMaker(v: VehiclePayload): string {
  // maker 列（others のみ）。maker セル = seriesGroup（実測で一致）
  return v.seriesGroup;
}

function decodeValue(
  layout: BrandLayout,
  col: ParsedColumn,
  v: VehiclePayload,
  flags: BrandFlags,
  enc: string | undefined,
) {
  if (enc === undefined || enc === "ASK") return askValue(layout, col, v, flags);
  if (enc === "—") return { kind: "not_offered" as const };
  if (/^\d+$/.test(enc)) return { kind: "yen" as const, value: Number(enc) };
  return { kind: "raw" as const, text: enc };
}

function askValue(layout: BrandLayout, col: ParsedColumn, v: VehiclePayload, flags: BrandFlags) {
  const hasNote = !!v.notes;
  const star = hasNote && layout.askStarColumns.includes(col.cellClassSuffix) ? " ★" : "";
  if (layout.hasGradeColumn) {
    return { kind: "ask" as const, askCar: v.carName, askGrade: (v.grade ?? "") + star };
  }
  // grade列なし:
  const base = layout.hasMakerColumn ? `${v.seriesGroup} ${v.carName}` : v.carName;
  if (flags.askHasDataGrade) {
    // vw 型: コード(engineFamily)がある行だけ data-grade を出す。無い行は属性ごと省略。
    if (!v.engineFamily && !star) return { kind: "ask" as const, askCar: base };
    return { kind: "ask" as const, askCar: base, askGrade: (v.engineFamily ?? "") + star };
  }
  // 通常の no-grade: ★ は data-car 側
  return { kind: "ask" as const, askCar: base + star };
}

// ── HTML 正規化＋差分（roundtrip と同等） ───────────────────────
function normTag(tag: string): string {
  const body = tag.replace(/^<\/?/, "").replace(/\/?>$/, "").trim();
  const close = /^<\//.test(tag) ? "/" : "";
  const name = /^([:\w-]+)/.exec(body)?.[1] ?? "";
  const rest = body.slice(name.length);
  const attrs: string[] = [];
  const re = /([:\w-]+)(?:\s*=\s*"([^"]*)")?/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(rest)) !== null) if (m[1]) attrs.push(m[2] !== undefined ? `${m[1]}="${m[2]}"` : m[1]);
  attrs.sort();
  return `<${close}${name}${attrs.length ? " " + attrs.join(" ") : ""}>`;
}
function tok(html: string): string[] {
  const out: string[] = [];
  for (const part of html.split(/(<[^>]+>)/)) {
    if (part.startsWith("<") && part.endsWith(">")) out.push(normTag(part));
    else {
      const t = part.replace(/\s+/g, " ").trim();
      if (t) out.push(t);
    }
  }
  return out;
}
function diff(live: string, gen: string): { count: number; samples: string[] } {
  const a = tok(live);
  const b = tok(gen);
  const samples: string[] = [];
  let count = 0;
  for (let i = 0; i < Math.max(a.length, b.length); i++)
    if (a[i] !== b[i]) {
      count++;
      if (samples.length < 6) samples.push(`     #${i} live:${a[i] ?? "(なし)"}  gen:${b[i] ?? "(なし)"}`);
    }
  return { count, samples };
}
const liveThead = (b: string) => /<thead>([\s\S]*?)<\/thead>/.exec(b)?.[1] ?? "";
const liveTbody = (b: string) => /<tbody[^>]*>([\s\S]*?)<\/tbody>/.exec(b)?.[1] ?? "";
function liveControls(b: string, p: string) {
  const o = new RegExp(`<div class="${p}-controls">`).exec(b);
  const t = new RegExp(`<div class="${p}-table-wrap">`).exec(b);
  return o && t ? b.slice(o.index + o[0].length, t.index).replace(/\s*<\/div>\s*$/, "") : "";
}

// ── フィールド充足レポート ───────────────────────────────────────
function fieldCoverage(vs: VehiclePayload[]): string {
  const n = vs.length;
  const nn = (f: (v: VehiclePayload) => unknown) => vs.filter((v) => f(v) != null && f(v) !== "").length;
  const priceKeys = new Set<string>();
  for (const v of vs) for (const k of Object.keys(v.prices)) priceKeys.add(k);
  return [
    `  行数=${n}`,
    `  carName=${nn((v) => v.carName)}/${n} grade=${nn((v) => v.grade)} engine=${nn((v) => v.engine)} engineFamily=${nn((v) => v.engineFamily)} ecuType=${nn((v) => v.ecuType)}`,
    `  stockOutput=${nn((v) => v.stockOutput)} stage1Gain=${nn((v) => v.stage1Gain)} labor=${nn((v) => v.labor)} shops=${nn((v) => v.shops)} notes=${nn((v) => v.notes)} remote=${nn((v) => Object.keys(v.remote).length)}`,
    `  prices列キー=[${[...priceKeys].join(",")}]`,
  ].join("\n");
}

// ── main ─────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const mode = args.includes("--commit") ? "commit" : "dry-run";
const pilotOnly = args.includes("--pilot");
const pilotIds = new Set(PILOTS.map((x) => x.id));

/**
 * --commit（本番VPSでのみ実行。Step A では実行しない）:
 *   0) 旧id（LEGACY_BRAND_IDS）を丸ごと削除（案B: prefix で作り直すため）。
 *   1) PriceBrand を prefix id で upsert。
 *   2) PriceVehicle は source='html' 行を洗い替え（deleteMany→createMany）を **1ブランド1トランザクション**で。
 *   派生インデックス data-search は保存しない（公開時に再生成する想定＝Step A' で searchIndexRule 化）。
 *
 * ガード（Claude Home判断4）:
 *   (a) 件数フロア: parse が 0行、または live の <tr> 数と不一致なら **そのブランドを中止**。
 *       洗い替えは delete→create の順で、create が失敗すると delete だけ済む事故になるため、
 *       トランザクションで囲んだ上で、書く前に「消してよい行数」を実測 tr 数と突き合わせる。
 *   (b) 手動行との重複: 洗い替え後、source='manual' と source='html' が同じ
 *       (carName+grade+engine) で衝突していたら警告（公開時は manual 優先を別途実装）。
 */
async function runCommit(): Promise<void> {
  // 型の摩擦を避けるため any 経由（このパスは Step A では実行しない）。
  const { PrismaClient } = (await import("../../src/generated/prisma/client")) as { PrismaClient: new (o: unknown) => unknown };
  const { PrismaPg } = (await import("@prisma/adapter-pg")) as { PrismaPg: new (s: string) => unknown };
  const adapter = new PrismaPg(process.env.DATABASE_URL as string);
  type Veh = { carName: string; grade: string | null; engine: string; source: string };
  const prisma = new PrismaClient({ adapter }) as {
    priceBrand: { upsert: (a: unknown) => Promise<unknown>; deleteMany: (a: unknown) => Promise<unknown> };
    priceVehicle: {
      deleteMany: (a: unknown) => Promise<unknown>;
      createMany: (a: unknown) => Promise<unknown>;
      findMany: (a: unknown) => Promise<Veh[]>;
    };
    $transaction: (ops: unknown[]) => Promise<unknown>;
    $disconnect: () => Promise<void>;
  };

  // 0) 旧id（Airtable由来5行）を purge。prefix で作り直すため残さない。
  await prisma.priceVehicle.deleteMany({ where: { brandId: { in: LEGACY_BRAND_IDS } } });
  await prisma.priceBrand.deleteMany({ where: { id: { in: LEGACY_BRAND_IDS } } });
  console.log(`旧id purge: ${LEGACY_BRAND_IDS.join(",")}`);

  const commitTables = discoverTables().filter((t) => (pilotOnly ? pilotIds.has(t.id) : true));
  const collisions: string[] = [];
  for (const t of commitTables) {
    const html = loadFixture(t.pageId);
    const pb = parseWpBlock(html, t);
    const brand = buildBrandPayload(pb);
    const remoteInfo = buildRemoteInfo(pb);
    const flags = brandFlags(pb);
    const vehicles = extractVehicles(pb, remoteInfo, flags);

    // (a) 件数フロア: 実測 <tr> 数と一致しなければ中止（パーサー破綻の握り潰し防止）。
    const liveTr = [...liveTbody(extractBlock(html, t.blockIndex)).matchAll(/<tr\b/g)].length;
    if (vehicles.length === 0 || vehicles.length !== liveTr) {
      throw new Error(
        `[${t.id}] 件数フロア違反: parse=${vehicles.length}行 vs live<tr>=${liveTr}行。` +
          `洗い替えを中止（DBは無変更）。パーサーを確認して。`,
      );
    }

    const brandData = {
      slug: brand.slug,
      displayName: brand.displayName,
      namespacePrefix: brand.namespacePrefix,
      seriesGroups: brand.seriesGroups,
      columns: brand.columns,
      intro: brand.intro,
      jsonLdDescription: brand.jsonLdDescription,
      wordPressPageId: brand.wordPressPageId,
      blockIndex: brand.blockIndex,
      layout: brand.layout,
      displayOrder: brand.displayOrder,
    };
    // 洗い替えは 1ブランド 1トランザクション（delete と create を不可分に）。
    await prisma.$transaction([
      prisma.priceBrand.upsert({
        where: { id: brand.id },
        create: { id: brand.id, ...brandData },
        update: brandData,
      }),
      prisma.priceVehicle.deleteMany({ where: { brandId: brand.id, source: "html" } }),
      prisma.priceVehicle.createMany({
        data: vehicles.map((v) => ({
          brandId: brand.id,
          market: v.market,
          source: v.source,
          seriesGroup: v.seriesGroup,
          carName: v.carName,
          grade: v.grade,
          engine: v.engine,
          engineFamily: v.engineFamily,
          ecuType: v.ecuType,
          stockOutput: v.stockOutput,
          stage1Gain: v.stage1Gain,
          prices: v.prices,
          labor: v.labor,
          shops: v.shops,
          remote: v.remote,
          notes: v.notes,
          displayOrder: v.displayOrder,
        })),
      }),
    ]);

    // (b) 手動行との重複検知（公開時 manual 優先の判断材料）。
    const manual = await prisma.priceVehicle.findMany({
      where: { brandId: brand.id, source: "manual" },
      select: { carName: true, grade: true, engine: true },
    });
    if (manual.length) {
      const key = (v: { carName: string; grade: string | null; engine: string }) =>
        `${v.carName}${v.grade ?? ""}${v.engine}`;
      const htmlKeys = new Set(vehicles.map(key));
      for (const m of manual)
        if (htmlKeys.has(key(m)))
          collisions.push(`  ${brand.id}: ${m.carName} / ${m.grade ?? "—"} / ${m.engine}`);
    }
    console.log(`commit ${brand.id}: PriceBrand + PriceVehicle(html) ${vehicles.length}行`);
  }
  if (collisions.length) {
    console.warn(
      `\n⚠ manual と html の重複 ${collisions.length}件（公開時は manual 優先ルールで解決する必要がある）:`,
    );
    for (const c of collisions) console.warn(c);
  }
  await prisma.$disconnect();
  console.log("--commit 完了。");
}

if (mode === "commit") {
  const backed = args.includes("--i-have-backed-up");
  if (!process.env.DATABASE_URL) {
    console.error("--commit には DATABASE_URL が必要（本番コンテナ内で実行する前提）。");
    process.exit(2);
  }
  if (!backed) {
    console.error(
      "ガード: --commit は先に pg_dump 退避が必須。退避後 --i-have-backed-up を付けて再実行。\n" +
        "  docker compose -f /root/mbfast-app/docker-compose.prod.yml exec -T postgres \\\n" +
        "    pg_dump -U mbfast -d mbfast -t '\"PriceBrand\"' -t '\"PriceVehicle\"' > pricebackup_$(date +%Y%m%d%H%M).sql",
    );
    process.exit(2);
  }
  await runCommit();
  process.exit(0);
}

// dry-run
let tables = discoverTables();
if (pilotOnly) tables = tables.filter((t) => pilotIds.has(t.id));

const tmp = mkdtempSync(join(tmpdir(), "importwp-"));
void tmp;
let anyFail = false;
const summary: string[] = [];

for (const t of tables) {
  const html = loadFixture(t.pageId);
  const block = extractBlock(html, t.blockIndex);
  const pb = parseWpBlock(html, t);
  const brand = buildBrandPayload(pb);
  const remoteInfo = buildRemoteInfo(pb);
  const flags = brandFlags(pb);
  const vehicles = extractVehicles(pb, remoteInfo, flags);
  const rebuilt = reconstructBlock(pb, vehicles, remoteInfo, flags);
  const gen = buildRegionsFromParsed(rebuilt);

  const dControls = diff(liveControls(block, t.prefix), gen.controls);
  const dThead = diff(liveThead(block), gen.thead);
  const dTbody = diff(liveTbody(block), gen.tbody);
  const zero = dControls.count + dThead.count + dTbody.count === 0 && vehicles.length === [...liveTbody(block).matchAll(/<tr\b/g)].length;
  if (!zero) anyFail = true;

  const idNote = PREFIX_TO_LEGACY_ID[t.id] ? `旧id=${PREFIX_TO_LEGACY_ID[t.id]}を削除→prefixで作成` : "新規(旧行なし)";
  const tag = pilotIds.has(t.id) ? "★" : " ";
  summary.push(`${tag}${t.id.padEnd(10)} 行${String(vehicles.length).padStart(3)}  ${zero ? "ゼロ差分" : `残差 c${dControls.count}/h${dThead.count}/b${dTbody.count}`}  brandId=${t.id} (案B確定・${idNote})`);

  if (pilotOnly || !zero) {
    console.log(`\n──── ${t.id} (page ${t.pageId} block ${t.blockIndex}) ────`);
    console.log(`  brandId: "${t.id}"（案B確定）  slug="${brand.slug}"  displayName="${brand.displayName}"  ${idNote}`);
    console.log(`  layout: naming=${pb.layout.naming} askStarColumns=[${pb.layout.askStarColumns.join(",")}] hasMaker=${pb.layout.hasMakerColumn}`);
    console.log(fieldCoverage(vehicles));
    console.log(`  再構成→生成 差分: controls=${dControls.count} thead=${dThead.count} tbody=${dTbody.count}`);
    for (const [nm, d] of [["controls", dControls], ["thead", dThead], ["tbody", dTbody]] as const)
      if (d.count) {
        console.log(`   [${nm}] 残差 ${d.count}:`);
        for (const s of d.samples) console.log(s);
      }
  }
}

console.log(`\n════════ import-wp --dry-run（意味ペイロード→再構成→生成 の差分） ════════`);
for (const s of summary) console.log(s);
console.log(`\n対象 ${tables.length} テーブル / ${anyFail ? "✗ 残差あり（下記詳細）" : "✔ 全ゼロ差分（意味フィールドから完全再構成）"}`);
console.log("注: <tr> data-search は派生インデックス（意味データでない）ため実測値を持ち回り。");
process.exit(anyFail ? 1 : 0);
