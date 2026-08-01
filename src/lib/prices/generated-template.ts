// HTML由来ブランドの公開HTMLテンプレートを columns(Json) から機械生成する。
// 既存4ブランド（templates.ts = ライブHTML抽出）と同じデザインシステム（白×ゴールド・LINE緑グラデ）。
// 制約: ブランド別CSSプレフィックス必須 / .active .hidden というクラス名は禁止 / <script> は ES5 のみ。
// scripts/check-generated-templates.mts が全ブランドの出力をチェックする。

import type { PriceHtmlTemplate } from "./templates";
import type { BrandRow, ColumnDefinition } from "./types";

// 価格キー → LINE問い合わせ用の正式ラベル（列ラベルは半角カナ等のためそのまま使わない）
export const ASK_LABELS: Record<string, string> = {
  babble: "バブリング",
  stage1: "ECUチューニング",
  stage2: "Stage2",
  limiterCut: "リミッター解除",
  limiterOpt: "リミッター解除OP",
  tcu: "TCUチューニング",
  tuning: "ECUチューニング",
  o2opf: "O2/OPFカット",
  mapswitch: "MapSwitch",
};

export function askLabelFor(col: ColumnDefinition): string {
  return ASK_LABELS[col.key] ?? col.label.replace(/<br\s*\/?>/g, "");
}

/*
 * 列順の共通ルール（本番の手作業の並びに合わせる。工賃列が無いブランドは何もしない）:
 *
 *   工賃（脱着工賃／脱着・殻割工賃／工賃／脱着等工賃）は
 *   **メインのECUチューニング価格列の直後**に置く。
 *   純正出力・Stage1出力向上・リミッター解除OP・O2/OPF・Stage2 等より前。
 *
 * メイン価格列の名前はブランドごとに違う（列名で判定する）:
 *   Mercedes(ガソリン) … Stage1(バブ無料)
 *   Mercedes(ディーゼル)… ECUチューニング
 *   Ferrari / その他 …… ECUチューニング(バブリング無料)
 *
 * 以前は key === "stage1" だけを見ていたため、メイン列のキーが tuning / ecuTuning の
 * ブランドでは「最後の価格列の直後」にフォールバックし、工賃が Stage2 や
 * リミッター解除OPより後ろに落ちていた（本番で人が直した並びと食い違う）。
 */

/** メイン価格列と見なすキー（左が優先）。ブランドによって命名が違う */
const MAIN_PRICE_KEYS = ["stage1", "ecuTuning", "tuning", "ecu_tuning"] as const;

/** メイン価格列と見なすラベル（キーで決まらないときの判定。全角/半角カナ・空白差を吸収） */
const MAIN_PRICE_LABEL_RE =
  /(ECU|ｅｃｕ)\s*(ﾁｭｰﾆﾝｸﾞ|チューニング)|Stage\s*1(?!\.)|ｽﾃｰｼﾞ\s*1/i;

const normalizeLabel = (s: string) => s.replace(/<br\s*\/?>/gi, "").replace(/\s+/g, "");

/**
 * メイン価格列の位置を返す（見つからなければ -1）。
 * 判定順: キーの一致 → ラベルの一致 → 最初の price 列。
 * 「最初の price 列」を最後の手段にしているのは、追加OP列（Stage2・リミッター解除OP）が
 * 後ろに並ぶ設計なので、先頭側の方がメインである可能性が高いため。
 */
export function findMainPriceIndex(cols: ColumnDefinition[]): number {
  const prices = cols.filter((c) => c.type === "price");
  if (prices.length === 0) return -1;
  for (const key of MAIN_PRICE_KEYS) {
    const i = cols.findIndex((c) => c.type === "price" && c.key === key);
    if (i >= 0) return i;
  }
  const byLabel = cols.findIndex(
    (c) => c.type === "price" && MAIN_PRICE_LABEL_RE.test(normalizeLabel(c.labelHtml ?? c.label)),
  );
  if (byLabel >= 0) return byLabel;
  return cols.findIndex((c) => c.type === "price");
}

export function applyColumnOrderRule(cols: ColumnDefinition[]): ColumnDefinition[] {
  const labor = cols.filter((c) => c.type === "labor");
  if (labor.length === 0) return cols; // 工賃データが無いブランドは列を作らない
  const rest = cols.filter((c) => c.type !== "labor");
  const anchor = findMainPriceIndex(rest);
  if (anchor === -1) return cols; // 価格列が無い（想定外）ときは並べ替えない
  return [...rest.slice(0, anchor + 1), ...labor, ...rest.slice(anchor + 1)];
}

// 列見出し: "ECUﾁｭｰﾆﾝｸﾞ(ﾊﾞﾌﾞﾘﾝｸﾞ無料)" → "ECUﾁｭｰﾆﾝｸﾞ<br><small>(ﾊﾞﾌﾞﾘﾝｸﾞ無料)</small>"
function headerHtml(col: ColumnDefinition): string {
  if (col.labelHtml) return col.labelHtml;
  const m = /^(.+?)(\([^)]*\))$/.exec(col.label);
  if (col.type === "price" && m) return `${m[1]}<br><small>${m[2]}</small>`;
  if (col.type === "output" && col.key === "stage1Gain") return "Stage1<br>出力向上";
  if (col.type === "ecu") return "ECU/TCU<br>型番";
  return col.label;
}

const SORTABLE_KEYS = new Set(["car", "grade", "engine"]);

export function buildGeneratedTemplate(brand: BrandRow): PriceHtmlTemplate {
  const p = brand.namespacePrefix; // "toyota-" 等
  if (!p || !/^[a-z0-9-]+-$/.test(p)) throw new Error(`namespacePrefix が不正です: "${p}"`);
  const name = brand.displayName;
  const cols = applyColumnOrderRule(brand.columns); // 工賃は価格列の直後（共通列順ルール）
  const hasSeries = brand.seriesGroups.length > 1;
  const hasRemote = cols.some((c) => c.type === "remote");
  const minWidth = Math.max(700, 240 + cols.length * 100);

  const ths = cols
    .map((c) => {
      if (SORTABLE_KEYS.has(c.key)) return `          <th class="${p}sortable" data-sort="${c.key}">${headerHtml(c)}</th>`;
      if (c.type === "price") return `          <th class="${p}col-price">${headerHtml(c)}</th>`;
      return `          <th>${headerHtml(c)}</th>`;
    })
    .join("\n");

  const filterGroup = hasSeries
    ? `
    <div class="${p}filter-group" role="group" aria-label="シリーズで絞り込み">
      <div class="${p}filter-label">シリーズ:</div>
      <button type="button" class="${p}filter-chip ${p}chip-on" data-filter-series="all">すべて</button>
{{FILTER_CHIPS}}
    </div>
`
    : "";

  const head = `<!-- ====================================================================
  ${name} ECUチューニング価格表 - mbFAST Tuning
  全{{TOTAL}}モデル / 価格マスターから自動生成（手編集禁止）
==================================================================== -->

<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Service",
  "name": "${name} ECUチューニング・バブリング施工",
  "provider": {
    "@type": "AutoRepair",
    "name": "mbFAST Tuning",
    "url": "https://mbfasttuning.com/"
  },
  "areaServed": "JP",
  "serviceType": "ECU Tuning / Pops and Bangs",
  "description": "{{JSONLD_DESCRIPTION}}"
}
</script>

<!-- START: 貼り付け範囲 -->
<div class="${p}price-wrapper" id="${p}wrapper">

  <div class="${p}intro">
    <p>{{INTRO}}</p>
  </div>

  <div class="${p}controls">
    <div class="${p}search-wrap">
      <input type="search" id="${p}search" class="${p}search"
             placeholder="🔍 車種・グレード・エンジンで検索"
             autocomplete="off">
      <button type="button" id="${p}clear" class="${p}clear" aria-label="クリア">×</button>
    </div>
${filterGroup}
    <div class="${p}result-count">
      <span id="${p}count">{{TOTAL}}</span> / {{TOTAL}} 件表示中
    </div>
  </div>

  <div class="${p}table-wrap">
    <table class="${p}price-table" id="${p}table">
      <thead>
        <tr>
${ths}
        </tr>
      </thead>
      <tbody id="${p}table-body">
`;

  const chip = `      <button type="button" class="${p}filter-chip" data-filter-series="{{S}}">{{S}}</button>`;

  const remoteNote = hasRemote
    ? `
    <p>📌 「リモート」列:
      <span class="${p}badge ${p}badge-remote">PG3</span> = Powergate3,
      <span class="${p}badge ${p}badge-remote">Flasher</span> = IXI Flasher,
      <span class="${p}badge ${p}badge-remote">AT</span> = AutoTuner,
      <span class="${p}badge ${p}badge-remote">AT1</span> = AutoTuner One で全国どこからでも施工可能です。
    </p>`
    : "";

  const foot = `      </tbody>
    </table>
  </div>

  <div class="${p}no-results" id="${p}no-results" style="display:none">
    該当する車種が見つかりませんでした。検索ワードやフィルタを変更してお試しください。
  </div>

  <div class="${p}table-note">
    <p>📌 上記は標準施工価格です。<span class="${p}ask-btn-inline"><span class="${p}ask-icon">💬</span><span class="${p}ask-text">LINE</span></span> ボタンが表示されているセルは、LINEで個別お見積りいたします。お気軽にお問い合わせください。</p>
    <p>📌 <span class="${p}cell-note">★</span> マーク: マウスオーバー(タップ)で備考を表示します。</p>${remoteNote}
  </div>

</div>

<style>
.${p}price-wrapper {
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif;
  color: #1a1a1a; max-width: 100%; margin: 0 0 2em 0;
  background: #ffffff; padding: 1.8em; border-radius: 12px;
  border: 1px solid #e5e5e5; box-shadow: 0 2px 16px rgba(0,0,0,0.05);
  position: relative; overflow: hidden;
}
.${p}price-wrapper::before {
  content: ''; position: absolute; top: 0; left: 0; right: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, #b8941f 20%, #d4af37 50%, #b8941f 80%, transparent);
}
.${p}intro {
  background: linear-gradient(135deg, #fafafa 0%, #f5f5f5 100%);
  border-left: 3px solid #b8941f; padding: 1.1em 1.4em;
  margin-bottom: 1.5em; border-radius: 2px;
}
.${p}intro p { margin: 0; line-height: 1.7; color: #333; font-size: 0.95rem; }
.${p}intro strong { color: #8a6d14; font-weight: 700; }
.${p}controls {
  background: #fafafa; border: 1px solid #e5e5e5;
  border-radius: 8px; padding: 1.2em 1.4em; margin-bottom: 1em;
}
.${p}search-wrap { position: relative; margin-bottom: 1.2em; }
.${p}search {
  width: 100%; padding: 0.85em 2.5em 0.85em 1.1em;
  font-size: 1rem; background: #ffffff;
  border: 1px solid #d0d0d0; border-radius: 6px;
  box-sizing: border-box; color: #1a1a1a;
  transition: all 0.2s; font-family: inherit;
}
.${p}search::placeholder { color: #999; }
.${p}search:focus {
  outline: none; border-color: #b8941f;
  box-shadow: 0 0 0 3px rgba(184, 148, 31, 0.12);
}
.${p}clear {
  position: absolute; right: 10px; top: 50%;
  transform: translateY(-50%);
  background: #ddd; border: none; color: #666;
  width: 28px; height: 28px; border-radius: 50%;
  cursor: pointer; font-size: 1rem; line-height: 1;
  display: none; transition: all 0.15s;
}
.${p}clear:hover { background: #b8941f; color: #fff; }
.${p}search:not(:placeholder-shown) ~ .${p}clear { display: block; }
.${p}filter-group {
  display: flex; flex-wrap: wrap; gap: 0.4em;
  align-items: center; margin-bottom: 0.7em;
}
.${p}filter-label {
  font-size: 0.78rem; color: #666; font-weight: 600;
  margin-right: 0.5em; min-width: 68px;
  letter-spacing: 0.05em; text-transform: uppercase;
}
.${p}filter-chip {
  padding: 0.4em 0.95em; font-size: 0.82rem;
  background: #ffffff; border: 1px solid #d5d5d5;
  border-radius: 3px; cursor: pointer;
  transition: all 0.15s; color: #555;
  font-family: inherit; font-weight: 500;
}
.${p}filter-chip:hover { background: #f0f0f0; border-color: #b0b0b0; color: #1a1a1a; }
.${p}filter-chip.${p}chip-on {
  background: linear-gradient(135deg, #d4af37 0%, #b8941f 100%);
  color: #ffffff; border-color: #b8941f; font-weight: 700;
  box-shadow: 0 2px 6px rgba(184, 148, 31, 0.25);
}
.${p}result-count {
  margin-top: 1em; padding-top: 1em;
  border-top: 1px solid #e5e5e5;
  font-size: 0.82rem; color: #666;
}
.${p}result-count #${p}count { font-weight: 700; color: #8a6d14; font-size: 1.05rem; }
.${p}table-wrap {
  overflow-x: auto; overflow-y: auto; max-height: 70vh;
  border: 1px solid #e0e0e0; border-radius: 6px; background: #ffffff;
}
.${p}price-table {
  width: 100%; border-collapse: collapse;
  font-size: 0.88rem; min-width: ${minWidth}px; color: #1a1a1a;
}
.${p}price-table thead th {
  background: linear-gradient(180deg, #2a2a2a 0%, #1a1a1a 100%);
  color: #d4af37; padding: 1em 0.7em;
  text-align: left; font-weight: 600;
  font-size: 0.78rem; letter-spacing: 0.08em;
  text-transform: uppercase; white-space: nowrap;
  position: sticky; top: 0; z-index: 1;
  border-bottom: 2px solid #b8941f;
}
.${p}price-table thead th small {
  font-weight: 400; opacity: 0.75; font-size: 0.68rem;
  letter-spacing: 0; text-transform: none;
  display: block; margin-top: 2px; color: #bbb;
}
.${p}price-table thead th.${p}sortable { cursor: pointer; user-select: none; }
.${p}price-table thead th.${p}sortable:hover { background: #333; color: #f0c850; }
.${p}price-table thead th.${p}sortable::after { content: ' ⇅'; opacity: 0.5; font-size: 0.8em; }
.${p}price-table thead th.${p}sort-asc::after { content: ' ▲'; opacity: 1; color: #d4af37; }
.${p}price-table thead th.${p}sort-desc::after { content: ' ▼'; opacity: 1; color: #d4af37; }
.${p}price-table tbody tr:nth-child(even) { background: #fafafa; }
.${p}price-table tbody td {
  padding: 0.85em 0.7em; border-bottom: 1px solid #eee;
  vertical-align: middle;
}
.${p}price-table tbody tr { transition: background 0.15s; }
.${p}price-table tbody tr:hover { background: #fff8e7; }
.${p}price-table tbody tr:hover .${p}cell-grade { color: #8a6d14; }
.${p}price-table tbody tr.${p}row-off { display: none; }
.${p}cell-car { white-space: nowrap; color: #1a1a1a; }
.${p}cell-car strong { font-weight: 700; }
.${p}cell-grade {
  white-space: nowrap; font-weight: 700;
  color: #a8851a; letter-spacing: 0.02em;
  transition: color 0.15s;
}
.${p}cell-engine {
  white-space: nowrap;
  font-family: 'SF Mono', 'Menlo', Consolas, monospace;
  font-size: 0.82rem; color: #555;
}
.${p}cell-ecu-tcu {
  white-space: nowrap;
  font-family: 'SF Mono', 'Menlo', Consolas, monospace;
  font-size: 0.76rem; color: #777;
}
.${p}cell-stock { white-space: nowrap; font-size: 0.84rem; color: #666; }
.${p}cell-stage1-gain {
  white-space: nowrap; font-size: 0.84rem;
  color: #c62828; font-weight: 600;
}
.${p}col-price, td[class^="${p}cell-price-"], .${p}cell-tcu, .${p}cell-labor {
  white-space: nowrap; text-align: right;
  font-variant-numeric: tabular-nums; font-size: 0.88rem;
}
td[class^="${p}cell-price-"] { font-weight: 700; color: #8a6d14; font-size: 0.92rem; }
.${p}cell-tcu { color: #a8851a; font-weight: 600; }
.${p}cell-labor { color: #777; font-size: 0.82rem; }
.${p}cell-shops { white-space: nowrap; font-size: 0.74rem; color: #666; }
.${p}cell-note {
  display: inline-block; margin-left: 0.4em;
  color: #d4af37; font-size: 0.85rem; cursor: help;
}
.${p}ask-btn {
  display: inline-flex; align-items: center; gap: 0.3em;
  padding: 0.35em 0.75em;
  background: linear-gradient(135deg, #06c755 0%, #04a043 100%);
  color: #ffffff !important; text-decoration: none !important;
  font-size: 0.78rem; font-weight: 700;
  letter-spacing: 0.04em; border-radius: 4px;
  border: none; cursor: pointer; white-space: nowrap;
  transition: all 0.15s;
  box-shadow: 0 1px 3px rgba(6, 199, 85, 0.3);
  font-family: inherit;
}
.${p}ask-btn:hover {
  background: linear-gradient(135deg, #05b54e 0%, #03933d 100%);
  transform: translateY(-1px);
  box-shadow: 0 3px 8px rgba(6, 199, 85, 0.4);
  color: #ffffff !important;
}
.${p}ask-btn:active { transform: translateY(0); box-shadow: 0 1px 2px rgba(6, 199, 85, 0.3); }
.${p}ask-btn .${p}ask-icon { font-size: 0.9em; }
.${p}ask-btn .${p}ask-text { letter-spacing: 0.05em; }
.${p}ask-btn-inline {
  display: inline-flex; align-items: center; gap: 0.25em;
  padding: 0.15em 0.5em;
  background: linear-gradient(135deg, #06c755 0%, #04a043 100%);
  color: #ffffff; font-size: 0.72rem; font-weight: 700;
  border-radius: 3px; vertical-align: middle;
}
.${p}ask-btn-inline .${p}ask-icon { font-size: 0.85em; }
.${p}badge {
  display: inline-block; padding: 0.18em 0.5em;
  font-size: 0.66rem; border-radius: 2px;
  font-weight: 700; letter-spacing: 0.04em;
  margin-left: 0.25em;
  font-family: 'SF Mono', Menlo, Consolas, monospace;
}
.${p}badge-engine {
  background: rgba(212, 175, 55, 0.15); color: #8a6d14;
  border: 1px solid rgba(184, 148, 31, 0.4);
}
.${p}badge-remote {
  background: rgba(46, 125, 50, 0.1); color: #2e7d32;
  border: 1px solid rgba(46, 125, 50, 0.3); margin-right: 0.25em;
}
.${p}muted { color: #ccc; font-size: 0.9em; }
.${p}no-results {
  padding: 3em 2em; text-align: center; color: #666;
  background: #fafafa; border: 1px solid #e5e5e5;
  border-radius: 6px; margin-top: 1em; font-size: 0.95rem;
}
.${p}table-note {
  margin-top: 1.2em; padding: 1.2em 1.4em;
  background: #fafafa; border: 1px solid #e5e5e5;
  border-left: 3px solid #b8941f; border-radius: 2px;
  font-size: 0.82rem; color: #555; line-height: 1.7;
}
.${p}table-note p { margin: 0.35em 0; }
.${p}table-note strong { color: #8a6d14; }
.${p}table-wrap::-webkit-scrollbar { height: 10px; width: 10px; background: #f5f5f5; }
.${p}table-wrap::-webkit-scrollbar-thumb { background: #ccc; border-radius: 5px; }
.${p}table-wrap::-webkit-scrollbar-thumb:hover { background: #b8941f; }
@media (max-width: 768px) {
  .${p}price-wrapper { padding: 1em; border-radius: 6px; }
  .${p}price-table { font-size: 0.78rem; min-width: ${Math.max(600, minWidth - 150)}px; }
  .${p}price-table thead th, .${p}price-table tbody td { padding: 0.55em 0.45em; }
  .${p}price-table thead th { font-size: 0.7rem; }
  .${p}filter-chip { font-size: 0.76rem; padding: 0.35em 0.75em; }
  .${p}search { font-size: 0.95rem; }
  .${p}intro { padding: 0.9em 1em; }
  .${p}intro p { font-size: 0.88rem; }
  .${p}ask-btn { font-size: 0.72rem; padding: 0.3em 0.6em; }
}
@media (max-width: 480px) {
  .${p}controls { padding: 0.9em; }
  .${p}filter-label { min-width: 52px; font-size: 0.72rem; }
  .${p}table-note { padding: 0.9em 1em; font-size: 0.78rem; }
}
</style>

<script>
(function() {
  'use strict';
  var wrapper = document.getElementById('${p}wrapper');
  var tbody = document.getElementById('${p}table-body');
  if (!wrapper || !tbody) return;
  var rows = [].slice.call(tbody.getElementsByTagName('tr'));
  var searchInput = document.getElementById('${p}search');
  var clearBtn = document.getElementById('${p}clear');
  var countEl = document.getElementById('${p}count');
  var noResultsEl = document.getElementById('${p}no-results');
  var tableWrap = wrapper.querySelector('.${p}table-wrap');
  var state = { query: '', series: 'all' };
  function applyFilters() {
    var q = state.query.replace(/^\\s+|\\s+$/g, '').toLowerCase();
    var visible = 0;
    for (var i = 0; rows.length > i; i++) {
      var row = rows[i];
      var searchText = row.getAttribute('data-search') || '';
      var rowSeries = row.getAttribute('data-series') || '';
      var matchSearch = !q || searchText.indexOf(q) !== -1;
      var matchSeries = state.series === 'all' || rowSeries === state.series;
      // WordPressのREST保存は本文中のアンパサンドを数値参照に変換するため、
      // 生成JSにはアンパサンドを一切書かない（論理AND演算子が壊れる）。
      // 同じ理由で小なり記号も使わない（比較は大なり側に寄せている）。
      if (!(!matchSearch || !matchSeries)) {
        row.className = row.className.replace(/\\s*${p}row-off/g, '');
        visible++;
      } else if (row.className.indexOf('${p}row-off') === -1) {
        row.className = row.className ? row.className + ' ${p}row-off' : '${p}row-off';
      }
    }
    countEl.textContent = String(visible);
    noResultsEl.style.display = visible > 0 ? 'none' : '';
    tableWrap.style.display = visible > 0 ? '' : 'none';
  }
  searchInput.onkeyup = function() { state.query = searchInput.value; applyFilters(); };
  searchInput.onsearch = function() { state.query = searchInput.value; applyFilters(); };
  clearBtn.onclick = function() {
    searchInput.value = ''; state.query = ''; applyFilters(); searchInput.focus();
  };
  var chips = [].slice.call(wrapper.querySelectorAll('[data-filter-series]'));
  for (var c = 0; chips.length > c; c++) {
    (function(btn) {
      btn.onclick = function() {
        for (var j = 0; chips.length > j; j++) {
          chips[j].className = chips[j].className.replace(/\\s*${p}chip-on/g, '');
        }
        btn.className = btn.className + ' ${p}chip-on';
        state.series = btn.getAttribute('data-filter-series');
        applyFilters();
      };
    })(chips[c]);
  }
  var headers = [].slice.call(wrapper.querySelectorAll('th.${p}sortable'));
  var allHeads = [].slice.call(wrapper.querySelectorAll('thead th'));
  var sortState = { col: null, asc: true };
  for (var h = 0; headers.length > h; h++) {
    (function(th) {
      var idx = -1;
      for (var k = 0; allHeads.length > k; k++) { if (allHeads[k] === th) { idx = k; break; } }
      th.onclick = function() {
        var col = th.getAttribute('data-sort');
        if (sortState.col === col) { sortState.asc = !sortState.asc; }
        else { sortState.col = col; sortState.asc = true; }
        for (var j = 0; headers.length > j; j++) {
          headers[j].className = headers[j].className.replace(/\\s*${p}sort-(asc|desc)/g, '');
        }
        th.className = th.className + (sortState.asc ? ' ${p}sort-asc' : ' ${p}sort-desc');
        var sorted = rows.slice().sort(function(a, b) {
          var av = (a.children[idx].textContent || '').replace(/^\\s+|\\s+$/g, '');
          var bv = (b.children[idx].textContent || '').replace(/^\\s+|\\s+$/g, '');
          return sortState.asc ? av.localeCompare(bv, 'ja') : bv.localeCompare(av, 'ja');
        });
        for (var r = 0; sorted.length > r; r++) { tbody.appendChild(sorted[r]); }
      };
    })(headers[h]);
  }
})();
</script>
<!-- END: 貼り付け範囲 -->
`;

  return { head, chip, foot };
}

// ════════════════════════════════════════════════════════════════════
//  Step A: ライブWordPress HTMLを正とした「版面駆動」生成
// ════════════════════════════════════════════════════════════════════
// パイロット各ブランド（lambo/ferrari/mbd/others）はライブHTMLごとに命名規約
// (camel/kebab)・id・クラス・列構成・cellクラスが異なる。これらを parse-wp.mts が
// 実測して ParsedBlock として渡し、ここが「データを担う領域」＝検索/フィルタ操作部・
// thead・tbody を再生成する。<style>/<script>/導入文/注記は版面固有の“ガワ”として
// layout に実測文字列で保持し（parse-wp.mts が抽出）、生成側は触らない。
// ラウンドトリップ検証(roundtrip.mts)は「価格値・行数・列構成・クラス名・ID」＝
// この3領域を突き合わせる。分岐（camel/kebab・id・class）はこの1関数群に閉じる。

/** ライブHTMLから実測した版面。DBの PriceBrand.layout(Json) に入る形。 */
export type BrandLayout = {
  namespacePrefix: string; // 素のプレフィックス "lambo"（クラスは "lambo-…"、data属性は "data-lambo-…"）
  naming: "camel" | "kebab"; // id の綴り方（search id に "-" があれば kebab）
  ids: {
    search: string;
    clear: string;
    count: string;
    noResults: string;
    tbody: string;
    table: string;
    wrapper: string | null;
  };
  classes: { hidden: string; active: string }; // 行非表示クラス / チップ選択クラス（プレフィックス込み実測値）
  minWidth: number; // .price-table の min-width(px)
  series: string[]; // フィルタチップ（"all" を除く）
  hasFilterGroup: boolean;
  filterLabel: string; // "モデル:" 等
  filterAria: string; // "モデルで絞り込み" 等
  placeholder: string; // 検索欄 placeholder（エンティティ保持）
  askHref: string; // LINE ask-btn の href
  hasGradeColumn: boolean; // grade 列があるか（ask-btn の data-grade 有無を決める）
  hasMakerColumn: boolean; // maker 列があるか（others のみ。data-car = "maker car"）
  // 備考★の付く列（cellClassSuffix）。ノート付き行の ask-btn は、grade列があれば data-grade に、
  // 無ければ data-car に " ★" を付ける。付く列はブランド＋列で一貫（実測してここに保持）。
  askStarColumns: string[];
  columnKeys: string[]; // 取込(実測)時点の列キー集合（cellClassSuffix）。A1の前方互換ガード用
  // ── 版面固有の“ガワ”（実測文字列・生成側は再構成しない） ──
  headerComment: string;
  jsonLd: string;
  introHtml: string;
  tableNoteHtml: string;
  styleHtml: string;
  scriptHtml: string;
  noResultsHtml: string;
  noResultsHidden: "hidden" | "style"; // no-results の隠し方（hidden 属性 or style=display:none）
  note: string; // 人間用メモ（ページID/ブロック等）
};

/** thead 1列 + その列の cell 生成規約。 */
export type ParsedColumn = {
  index: number;
  sortKey: string; // "car"/"grade"/"engine"/"maker" or "c{index}"
  cellClassSuffix: string; // "cell-car" / "cell-price-stage1" / "cell-tcu" 等（プレフィックス無し）
  role: "car" | "grade" | "engine" | "maker" | "price" | "tcu" | "labor" | "text";
  headerHtml: string; // <th> の中身（<br><small> 保持）
  colPrice: boolean; // th に {p}-col-price を付けるか
  sortable: boolean; // th に {p}-sortable を付けるか
  askLabel: string | null; // ask-btn の data-label（その列で初めて現れた ask から実測）
  titleLabel: string | null; // title の【…見積希望】部分
};

/** 価格系セル（price/tcu/labor）の正規化値（spec 2.2）。 */
export type CellValue =
  | { kind: "yen"; value: number } // "¥198,000" → 198000
  | { kind: "raw"; text: string } // "+¥11,000" / "ロック解除必要" 等はそのまま
  | { kind: "not_offered" } // "—"（上位グレード非提供）
  // 空欄 / ASK / LINEボタン → 価格NULL。ask-btn の data-car / data-grade は
  // ライブHTMLで同一行内でも列により ★ の有無が揺れる（ルール化不能な原本ノイズ）。
  // 生成で辻褄を合わせず、その列セルの data-car / data-grade を実測して保持する。
  | { kind: "ask"; askCar: string; askGrade?: string };

/** tbody 1行。text 系セルは実測 innerHTML を保持（そのまま再出力）。 */
export type ParsedRow = {
  series: string; // data-{p}-series（便宜アクセサ）
  searchText: string; // data-{p}-search（便宜アクセサ）
  // <tr> の data-* 属性を実測順で全保持（search/series の他に engine-family 等を持つ版面がある）
  dataAttrs: { name: string; value: string }[];
  cells: CellCell[];
};

export type CellCell =
  | { role: "value"; value: CellValue } // price/tcu/labor 列
  | { role: "verbatim"; innerHtml: string }; // それ以外（実測 innerHTML）

export type ParsedBlock = {
  pageId: number;
  blockIndex: number;
  layout: BrandLayout;
  columns: ParsedColumn[];
  rows: ParsedRow[];
};

// ── 命名規約ヘルパ ───────────────────────────────────────────────
const cls = (p: string, name: string) => `${p}-${name}`; // クラス（常に kebab プレフィックス）
const dataAttr = (p: string, name: string) => `data-${p}-${name}`; // data属性

/** 数値 → "¥198,000"（en-US 桁区切り・全角¥は使わない） */
function yen(n: number): string {
  return "¥" + n.toLocaleString("en-US");
}

/** ask-btn 1個の HTML を版面規約で再構成する（data-car / data-grade はセルごとの実測値）。 */
function buildAskBtn(
  layout: BrandLayout,
  col: ParsedColumn,
  askCar: string,
  askGrade: string | undefined,
): string {
  const p = layout.namespacePrefix;
  // data-car / data-grade は同一行内でも列で ★ の有無が揺れるためセル単位で実測保持する。
  const dataGradeAttr = askGrade !== undefined ? ` data-grade="${askGrade}"` : "";
  // title 末尾 = (data-car [+ " " + data-grade]) を trim。空なら 】直後に何も付けない。
  const tail = (askCar + (askGrade !== undefined ? " " + askGrade : "")).trim();
  const title = `LINEで問い合わせ:【${col.titleLabel ?? ""}見積希望】${tail}`;
  return (
    `<a href="${layout.askHref}" target="_blank" rel="noopener" class="${cls(p, "ask-btn")}"` +
    ` data-car="${askCar}"${dataGradeAttr} data-label="${col.askLabel ?? ""}" title="${title}">` +
    `<span class="${cls(p, "ask-icon")}">&#x1f4ac;</span>` +
    `<span class="${cls(p, "ask-text")}">LINE</span></a>`
  );
}

/** price/tcu/labor セルの中身を正規化値から再構成する。 */
function buildValueInner(layout: BrandLayout, col: ParsedColumn, v: CellValue): string {
  const p = layout.namespacePrefix;
  switch (v.kind) {
    case "yen":
      return yen(v.value);
    case "raw":
      return v.text;
    case "not_offered":
      return `<span class="${cls(p, "muted")}">—</span>`;
    case "ask":
      return buildAskBtn(layout, col, v.askCar, v.askGrade);
  }
}

/** 1セルの <td> を生成する。 */
function buildCell(layout: BrandLayout, col: ParsedColumn, cell: CellCell): string {
  const p = layout.namespacePrefix;
  const klass = `${p}-${col.cellClassSuffix}`;
  const inner = cell.role === "verbatim" ? cell.innerHtml : buildValueInner(layout, col, cell.value);
  return `    <td class="${klass}">${inner}</td>`;
}

/** 検索/フィルタ操作部（<div class="{p}-controls"> の中身）を生成する。 */
export function buildControlsRegion(pb: ParsedBlock): string {
  const { layout } = pb;
  const p = layout.namespacePrefix;
  const total = pb.rows.length;
  const search = `    <div class="${cls(p, "search-wrap")}">
      <input type="search" id="${layout.ids.search}" class="${cls(p, "search")}" placeholder="${layout.placeholder}" autocomplete="off">
      <button type="button" id="${layout.ids.clear}" class="${cls(p, "clear")}" aria-label="クリア">×</button>
    </div>`;

  let filter = "";
  if (layout.hasFilterGroup) {
    const chips = [
      `      <button type="button" class="${cls(p, "filter-chip")} ${layout.classes.active}" ${dataAttr(p, "filter-series")}="all">すべて</button>`,
      ...layout.series.map(
        (s) =>
          `      <button type="button" class="${cls(p, "filter-chip")}" ${dataAttr(p, "filter-series")}="${s}">${s}</button>`,
      ),
    ].join("\n");
    filter = `\n    <div class="${cls(p, "filter-group")}" role="group" aria-label="${layout.filterAria}">
      <div class="${cls(p, "filter-label")}">${layout.filterLabel}</div>
${chips}
    </div>`;
  }

  const count = `    <div class="${cls(p, "result-count")}">
      <span id="${layout.ids.count}">${total}</span> / ${total} 件表示中
    </div>`;

  return `${search}${filter}\n${count}`;
}

/** thead の <tr>…</tr> を生成する。 */
export function buildTheadRegion(pb: ParsedBlock): string {
  const { layout, columns } = pb;
  const p = layout.namespacePrefix;
  const ths = columns
    .map((c) => {
      const classes = [c.colPrice ? cls(p, "col-price") : null, c.sortable ? cls(p, "sortable") : null]
        .filter(Boolean)
        .join(" ");
      return `          <th class="${classes}" ${dataAttr(p, "sort")}="${c.sortKey}">${c.headerHtml}</th>`;
    })
    .join("\n");
  return `<tr>\n${ths}\n        </tr>`;
}

/** tbody の全 <tr> を生成する。 */
export function buildTbodyRegion(pb: ParsedBlock): string {
  const { layout, columns, rows } = pb;
  return rows
    .map((row) => {
      const cells = columns.map((col, i) => buildCell(layout, col, row.cells[i])).join("\n");
      const trAttrs = row.dataAttrs.map((a) => `${a.name}="${a.value}"`).join(" ");
      return `<tr ${trAttrs}>\n${cells}\n  </tr>`;
    })
    .join("\n");
}

/** 3領域をまとめて返す（roundtrip 比較用）。 */
export function buildRegionsFromParsed(pb: ParsedBlock): {
  controls: string;
  thead: string;
  tbody: string;
} {
  return {
    controls: buildControlsRegion(pb),
    thead: buildTheadRegion(pb),
    tbody: buildTbodyRegion(pb),
  };
}
