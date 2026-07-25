// Airtable由来15ブランドの公開HTMLテンプレートを columns(Json) から機械生成する。
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
  const cols = brand.columns;
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
      if (matchSearch && matchSeries) {
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
