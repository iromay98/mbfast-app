/*
 * 車両バリアント個別ページのHTML生成（JP/EN）。
 *
 * 方針は価格表と同じ:
 *   - DBに依存しない純関数（入力は types.ts の VehiclePageData）
 *   - 出力は wp:html ブロック1個 + マーカー区間（同期はマーカー内側だけ差し替える）
 *   - **アンパサンドと小なり記号をJS内に書かない** … このページはそもそもJS無し（静的）
 *   - JSON-LD は "<" を \u003c にエスケープしてから埋め込む
 *
 * デザイン: JP=白地×ゴールド（本体サイトのトーン）/ EN=黒地×ゴールド（EN記事テンプレ準拠）。
 * CSSは .vpg- プレフィックスでスコープ（postid依存にしない＝ページ複製やIDズレに強い）。
 */
import type { GeneratedPage, PriceItem, VehiclePageData } from "./types";

import { REMOTE_TOOLS } from "../prices/types";

const LINE_URL = "https://lin.ee/8yOXuPJ";
const MARK_START = "<!-- START: 貼り付け範囲 -->";
const MARK_END = "<!-- END: 貼り付け範囲 -->";

export const VPAGE_MARK_START = MARK_START;
export const VPAGE_MARK_END = MARK_END;


function esc(s: string): string {
  return s.replace(/&/g, "＆").replace(/</g, "‹").replace(/>/g, "›").replace(/"/g, "”");
}

/** JSON-LD 用: scriptタグ内で安全な文字列にする（"<" を \u003c に） */
function jsonLd(obj: unknown): string {
  return JSON.stringify(obj).replace(/</g, "\\u003c").replace(/&/g, "\\u0026");
}

/** "457ps/600Nm" + "+53ps/50Nm" → { stockPs, stockNm, tunedPs, tunedNm } | null */
export function computeOutputs(stock: string | null, gain: string | null) {
  if (!stock) return null;
  const sm = stock.match(/(\d+(?:\.\d+)?)\s*ps(?:\s*[/／]\s*(\d+(?:\.\d+)?)\s*Nm)?/i);
  if (!sm) return null;
  const stockPs = Number(sm[1]);
  const stockNm = sm[2] ? Number(sm[2]) : null;
  let tunedPs: number | null = null;
  let tunedNm: number | null = null;
  if (gain) {
    const gm = gain.match(/\+\s*(\d+(?:\.\d+)?)\s*ps(?:\s*[/／]\s*(?:\+\s*)?(\d+(?:\.\d+)?)\s*Nm)?/i);
    if (gm) {
      tunedPs = stockPs + Number(gm[1]);
      if (stockNm !== null && gm[2]) tunedNm = stockNm + Number(gm[2]);
    }
  }
  return { stockPs, stockNm, tunedPs, tunedNm };
}

function fmtYen(v: string): string {
  const n = Number(v.replace(/[^0-9]/g, ""));
  if (!Number.isFinite(n) || n === 0) return v;
  return "¥" + n.toLocaleString("ja-JP");
}

function isAsk(v: string): boolean {
  return v.trim() === "" || v.trim().toUpperCase() === "ASK";
}

function vehicleTitle(d: VehiclePageData): string {
  return [d.carName, d.grade].filter(Boolean).join(" ");
}

/* ───────────────── 共通CSS ───────────────── */

function css(dark: boolean): string {
  const bg = dark ? "#0d0d0d" : "#ffffff";
  const fg = dark ? "#F2F2F2" : "#1a1a1a";
  const sub = dark ? "#b9b9b9" : "#666";
  const line = dark ? "#2c2c2c" : "#e5e5e5";
  const cardBg = dark ? "#161616" : "#fafafa";
  return `
<style>
/* テーマのページタイトル帯・パンくず・メタを非表示（このページ内にしか効かない） */
.breadSection,.breadcrumb,.veu-breadcrumb,h1.entry-title,.page-header,.entry-meta{display:none!important}
.siteContent{padding-top:0!important;margin-top:0!important;padding-bottom:0!important;background:${bg}!important}
.siteContent .entry-body,.siteContent .section{padding-top:0!important;padding-bottom:0!important}
.vpg-wrap{background:${bg};color:${fg};max-width:860px;margin:0 auto;padding:1.5rem 1rem 3rem;font-feature-settings:"palt"}
.vpg-wrap h1{font-size:1.5rem;line-height:1.4;margin:0 0 .3em;color:${fg}}
.vpg-wrap h2{font-size:1.15rem;margin:2.2em 0 .8em;padding-left:.6em;border-left:4px solid #EC6420;color:${fg}}
.vpg-kicker{color:#c9a24b;font-size:.8rem;letter-spacing:.12em;text-transform:uppercase;margin-bottom:.4em}
.vpg-sub{color:${sub};font-size:.9rem;margin:0 0 1.2em}
.vpg-hero{display:flex;gap:1.5rem;flex-wrap:wrap;align-items:flex-end;border-bottom:1px solid ${line};padding-bottom:1.2rem}
.vpg-power{display:flex;gap:1rem;flex-wrap:wrap;margin:1.4rem 0}
.vpg-pcard{flex:1 1 180px;background:${cardBg};border:1px solid ${line};border-radius:10px;padding:1rem 1.1rem;text-align:center}
.vpg-pcard .vpg-plabel{font-size:.78rem;color:${sub};letter-spacing:.08em}
.vpg-pcard .vpg-pval{font-size:1.55rem;font-weight:700;margin-top:.15em}
.vpg-pcard--tuned{border-color:#c9a24b;box-shadow:0 0 0 1px #c9a24b inset}
.vpg-pcard--tuned .vpg-pval{color:#c9a24b}
.vpg-gain{font-size:.82rem;color:#EC6420;font-weight:600;margin-top:.2em}
.vpg-bars{margin:.4rem 0 1.6rem}
.vpg-bar-row{display:flex;align-items:center;gap:.6rem;margin:.5rem 0}
.vpg-bar-label{width:6.5em;font-size:.74rem;color:${sub};text-align:right;white-space:nowrap}
.vpg-bar-track{flex:1;height:15px;background:${dark ? "#1d1d1d" : "#eee"};border-radius:8px;overflow:hidden}
.vpg-bar-fill{height:100%;border-radius:8px;width:0}
.vpg-on .vpg-bar-fill{animation:vpgGrow 1.1s cubic-bezier(.2,.7,.2,1) forwards}
.vpg-bar-fill--stock{background:${dark ? "#4a4a4a" : "#b9b9b9"};animation-delay:.15s}
.vpg-bar-fill--tuned{background:linear-gradient(90deg,#c9a24b,#EC6420);animation-delay:.45s;box-shadow:0 0 14px rgba(236,100,32,.4)}
.vpg-bar-val{width:6.2em;font-size:.78rem;font-weight:700;white-space:nowrap}
.vpg-bar-val--tuned{color:#EC6420}
@keyframes vpgGrow{from{width:0}to{width:var(--w)}}
@keyframes vpgPulse{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}
.vpg-on .vpg-gain{animation:vpgPulse 2.4s ease-in-out .9s 2}
.vpg-dealer{margin-top:1.6rem;border:1px dashed ${line};border-radius:10px;padding:1rem 1.1rem}
.vpg-dealer .vpg-dealer-t{font-size:.8rem;font-weight:700;color:#c9a24b;margin:0 0 .4em}
.vpg-dealer p{font-size:.82rem;color:${sub};margin:.2em 0 .7em;line-height:1.7}
.vpg-dealer a{font-size:.8rem;color:#c9a24b;text-decoration:underline}
.vpg-table{width:100%;border-collapse:collapse;font-size:.92rem}
.vpg-table th,.vpg-table td{border:1px solid ${line};padding:.55em .7em;text-align:left}
.vpg-table th{background:${dark ? "#1d1d1d" : "#f3f3f3"};font-weight:600;white-space:nowrap}
.vpg-table td.vpg-price{font-weight:700;white-space:nowrap}
.vpg-ok{color:#c9a24b;font-weight:700}
.vpg-ng{color:${sub}}
.vpg-ask{display:inline-block;background:#06C755;color:#fff;border-radius:6px;padding:.25em .7em;font-size:.8rem;font-weight:600;text-decoration:none}
.vpg-badges{display:flex;gap:.4rem;flex-wrap:wrap}
.vpg-badge{background:${dark ? "#232323" : "#efefef"};border:1px solid ${line};border-radius:5px;padding:.15em .55em;font-size:.75rem}
.vpg-related{list-style:none;padding:0;margin:0}
.vpg-related li{border:1px solid ${line};border-radius:8px;margin-bottom:.6rem}
.vpg-related a{display:block;padding:.7em .9em;text-decoration:none;color:${fg};font-size:.92rem}
.vpg-related a:hover{border-color:#c9a24b;color:#c9a24b}
.vpg-cta{margin-top:2.5rem;background:${dark ? "#161616" : "#111"};color:#F2F2F2;border-radius:12px;padding:1.4rem 1.2rem;text-align:center}
.vpg-cta p{margin:.2em 0 .9em;font-size:.9rem;color:#cfcfcf}
.vpg-cta a{display:inline-block;background:#06C755;color:#fff;font-weight:700;border-radius:8px;padding:.7em 1.6em;text-decoration:none;margin:0 .3em}
.vpg-cta a.vpg-cta-alt{background:#c9a24b;color:#111}
.vpg-note{font-size:.78rem;color:${sub};margin-top:2rem;line-height:1.7}
@media(max-width:560px){.vpg-wrap h1{font-size:1.25rem}.vpg-pcard .vpg-pval{font-size:1.3rem}}
</style>`;
}

/* ───────────────── パーツ ───────────────── */

function powerCards(d: VehiclePageData, l: { stock: string; tuned: string; ps: string; tq: string }): string {
  const o = computeOutputs(d.stockOutput, d.stage1Gain);
  if (!o) return "";
  const nm = (v: number | null) => (v !== null ? ` / ${v}Nm` : "");
  const tunedCard =
    o.tunedPs !== null
      ? `<div class="vpg-pcard vpg-pcard--tuned"><div class="vpg-plabel">${l.tuned}</div><div class="vpg-pval"><span class="vpg-num" data-from="${o.stockPs}" data-to="${o.tunedPs}">${o.stockPs}</span>ps${o.tunedNm !== null ? ` / <span class="vpg-num" data-from="${o.stockNm ?? 0}" data-to="${o.tunedNm}">${o.stockNm ?? 0}</span>Nm` : ""}</div><div class="vpg-gain">${esc(d.stage1Gain ?? "")}</div></div>`
      : "";
  const cards = `<div class="vpg-power">
<div class="vpg-pcard"><div class="vpg-plabel">${l.stock}</div><div class="vpg-pval">${o.stockPs}ps${nm(o.stockNm)}</div></div>
${tunedCard}</div>`;

  // 純正 vs チューニング後の伸びるパワーバー（CSSアニメ・JS不要）
  if (o.tunedPs === null) return cards;
  const rows: string[] = [];
  const psMax = o.tunedPs;
  rows.push(barRow(`${l.stock} ${l.ps}`, `${o.stockPs}ps`, (o.stockPs / psMax) * 100, false));
  rows.push(barRow(`${l.tuned} ${l.ps}`, `${o.tunedPs}ps`, 100, true));
  if (o.stockNm !== null) {
    if (o.tunedNm !== null) {
      const nmMax = o.tunedNm;
      rows.push(barRow(`${l.stock} ${l.tq}`, `${o.stockNm}Nm`, (o.stockNm / nmMax) * 100, false));
      rows.push(barRow(`${l.tuned} ${l.tq}`, `${o.tunedNm}Nm`, 100, true));
    }
  }
  return `${cards}<div class="vpg-bars">
${rows.join("\n")}
</div>`;
}

function barRow(label: string, val: string, pct: number, tuned: boolean): string {
  const w = Math.max(8, Math.round(pct));
  return `<div class="vpg-bar-row"><span class="vpg-bar-label">${label}</span><span class="vpg-bar-track"><span class="vpg-bar-fill${tuned ? " vpg-bar-fill--tuned" : " vpg-bar-fill--stock"}" style="--w:${w}%"></span></span><span class="vpg-bar-val${tuned ? " vpg-bar-val--tuned" : ""}">${val}</span></div>`;
}

/** 数字カウントアップ。**アンパサンド・小なり記号を含まない**制約下で書いたJS（作業ルール2/価格表と同じ理由） */
const COUNT_SCRIPT = `<script>
(function(){
  var fired=false;
  function countUp(el){
    var to=parseInt(el.getAttribute("data-to"),10);
    var from=parseInt(el.getAttribute("data-from"),10);
    if(isNaN(to)){return;}
    if(isNaN(from)){from=0;}
    var dur=1300;
    var start=null;
    function step(ts){
      if(start===null){start=ts;}
      var p=(ts-start)/dur;
      if(p>1){p=1;}
      var eased=1-Math.pow(1-p,3);
      el.textContent=String(Math.round(from+(to-from)*eased));
      if(p>=1){return;}
      window.requestAnimationFrame(step);
    }
    window.requestAnimationFrame(step);
  }
  function fire(){
    if(fired){return;}
    fired=true;
    document.querySelectorAll(".vpg-power, .vpg-bars").forEach(function(el){el.classList.add("vpg-on");});
    document.querySelectorAll(".vpg-num[data-to]").forEach(countUp);
  }
  var target=document.querySelector(".vpg-power");
  if(!target){target=document.querySelector(".vpg-bars");}
  if(!target){return;}
  if(typeof IntersectionObserver==="undefined"){fire();return;}
  var io=new IntersectionObserver(function(entries){
    entries.forEach(function(e){
      if(e.isIntersecting){fire();io.disconnect();}
    });
  },{threshold:0.35});
  io.observe(target);
})();
</script>`;

function specRows(d: VehiclePageData, jp: boolean): string {
  const rows: [string, string][] = [];
  rows.push([jp ? "車種（型式）" : "Model (Chassis)", esc(vehicleTitle(d))]);
  if (d.engine) rows.push([jp ? "エンジン" : "Engine", esc(d.engine)]);
  if (d.ecuType) rows.push(["ECU/TCU", esc(d.ecuType)]);
  if (d.stockOutput) rows.push([jp ? "純正出力" : "Stock Output", esc(d.stockOutput)]);
  if (d.stage1Gain) rows.push([jp ? "Stage1出力向上" : "Stage 1 Gain", esc(d.stage1Gain)]);
  return rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("\n");
}

function priceTable(items: PriceItem[], jp: boolean, withAskBtn: boolean): string {
  const shown = items.filter((p) => !(isAsk(p.value) && !withAskBtn));
  if (shown.length === 0) return "";
  const rows = shown
    .map((p) => {
      const val = isAsk(p.value)
        ? `<a class="vpg-ask" href="${LINE_URL}" target="_blank" rel="noopener">LINE${jp ? "でお見積り" : " Quote"}</a>`
        : fmtYen(p.value);
      return `<tr><th>${esc(p.label)}</th><td class="vpg-price">${val}</td></tr>`;
    })
    .join("\n");
  return `<table class="vpg-table"><tbody>\n${rows}\n</tbody></table>`;
}

function optionTable(d: VehiclePageData, jp: boolean): string {
  const entries = d.optionDefs.filter((o) => d.options[o.key] !== undefined);
  if (entries.length === 0) return "";
  const rows = entries
    .map((o) => {
      const on = d.options[o.key] === true;
      const mark = on ? `<span class="vpg-ok">〇</span>` : `<span class="vpg-ng">—</span>`;
      return `<tr><th>${jp ? o.jp : o.en}</th><td>${mark}</td></tr>`;
    })
    .join("\n");
  return `<table class="vpg-table"><tbody>\n${rows}\n</tbody></table>`;
}

/**
 * 業者専用ツール。AutoTuner(AT/AT1)は代理店向けの機材なので、お客様向けの
 * 「リモート施工対応」には出さない（個人で使えると誤解されるため。更家さん指定）。
 * PG3・Flasherはお客様にお送りして使っていただくため、お客様向けに出す。
 */
const DEALER_ONLY_TOOLS = new Set(["autoTuner", "atOne"]);

/** お客様向けのリモート施工対応（業者専用ツールは除外） */
function customerRemoteBadges(d: VehiclePageData): string {
  const tools = REMOTE_TOOLS.filter((t) => d.remote[t.key]).filter((t) => !DEALER_ONLY_TOOLS.has(t.key));
  if (tools.length === 0) return "";
  return `<div class="vpg-badges">${tools.map((t) => `<span class="vpg-badge" title="${t.title}">${t.badge}</span>`).join("")}</div>`;
}

function dealerBlock(d: VehiclePageData, jp: boolean): string {
  const supported = REMOTE_TOOLS.filter((t) => d.remote[t.key]).filter((t) => DEALER_ONLY_TOOLS.has(t.key));
  if (supported.length === 0) return "";
  const tools = supported.map((t) => `<span class="vpg-badge" title="${t.title}">${t.badge}</span>`).join("");
  if (jp) {
    return `<div class="vpg-dealer">
<p class="vpg-dealer-t">整備工場・ショップ運営者様へ（代理店募集）</p>
<p>この車種は業者向けリモート施工ツールに対応しており、貴店の設備でmbFASTのチューニングメニューを提供いただけます。施工メニューへの追加をご検討の業者様はお気軽にご相談ください。</p>
<div class="vpg-badges">${tools}</div>
<p style="margin-top:.7em"><a href="${LINE_URL}" target="_blank" rel="noopener">代理店・提携についてLINEで問い合わせる</a></p>
</div>`;
  }
  return `<div class="vpg-dealer">
<p class="vpg-dealer-t">For Workshops (Dealer Program)</p>
<p>This model is supported by our dealer-facing remote tuning tools. Workshops interested in offering mbFAST tuning files can get in touch below.</p>
<div class="vpg-badges">${tools}</div>
<p style="margin-top:.7em"><a href="${LINE_URL}" target="_blank" rel="noopener">Dealer inquiries</a></p>
</div>`;
}

function relatedList(d: VehiclePageData): string {
  if (d.related.length === 0) return "";
  return `<ul class="vpg-related">
${d.related.map((r) => `<li><a href="${r.url}">${esc(r.title)}</a></li>`).join("\n")}
</ul>`;
}

/* ───────────────── JP ───────────────── */

export function generateVehiclePageJp(d: VehiclePageData): GeneratedPage {
  const name = vehicleTitle(d);
  const title = `${d.brandDisplayName} ${name} ECUチューニング｜価格・馬力・対応オプション`;
  const o = computeOutputs(d.stockOutput, d.stage1Gain);

  const ld = jsonLd({
    "@context": "https://schema.org",
    "@type": "Service",
    name: `${d.brandDisplayName} ${name} ECUチューニング`,
    provider: { "@type": "AutoRepair", name: "mbFAST Tuning" },
    areaServed: "JP",
    description:
      o && o.tunedPs !== null
        ? `${d.brandDisplayName} ${name}のECUチューニング。純正${o.stockPs}psから${o.tunedPs}psへ。バブリング・各種オプション対応。`
        : `${d.brandDisplayName} ${name}のECUチューニング・バブリング施工。`,
    offers: d.prices
      .filter((p) => !isAsk(p.value))
      .map((p) => ({
        "@type": "Offer",
        name: p.label,
        price: p.value.replace(/[^0-9]/g, ""),
        priceCurrency: "JPY",
      })),
  });

  const priceItems = d.prices;
  const html = `<!-- wp:html -->
${MARK_START}
${css(true)}
<div class="vpg-wrap">
<div class="vpg-kicker">${esc(d.brandNameEn)} ECU TUNING</div>
<div class="vpg-hero"><h1>${esc(name)}<br>ECUチューニング・バブリング</h1></div>
<p class="vpg-sub">エンジン: ${esc(d.engine)}${d.ecuType ? `　ECU: ${esc(d.ecuType)}` : ""}</p>
${powerCards(d, { stock: "純正", tuned: "チューニング後", ps: "馬力", tq: "トルク" })}
<h2>車両スペック</h2>
<table class="vpg-table"><tbody>
${specRows(d, true)}
</tbody></table>
<h2>施工価格（税込）</h2>
${priceTable(priceItems, true, true)}
${d.labor && d.labor !== "—" ? `<p class="vpg-sub">脱着・殻割り工賃: ${esc(d.labor)}</p>` : ""}
${customerRemoteBadges(d) ? `<h2>リモート施工対応</h2>\n<p class="vpg-sub">専用機材をご自宅にお送りし、ご来店不要で施工いたします。</p>\n${customerRemoteBadges(d)}` : ""}
${optionTable(d, true) ? `<h2>対応オプション</h2>\n${optionTable(d, true)}` : ""}
${relatedList(d) ? `<h2>この型式の施工実績</h2>\n${relatedList(d)}` : ""}
<div class="vpg-cta">
<p>${esc(name)} のチューニングは、実績データに基づいてご提案します。</p>
<a href="${LINE_URL}" target="_blank" rel="noopener">LINEで相談する</a>
</div>
${dealerBlock(d, true)}
<p class="vpg-note">※価格・出力値は予告なく変更になる場合があります。出力向上値は車両個体・使用燃料により変動します。${d.notes ? `　${esc(d.notes)}` : ""}</p>
</div>
${COUNT_SCRIPT}
<script type="application/ld+json">${ld}</script>
${MARK_END}
<!-- /wp:html -->`;
  return { title, html };
}

/* ───────────────── EN ───────────────── */

export function generateVehiclePageEn(d: VehiclePageData): GeneratedPage {
  const name = vehicleTitle(d);
  const title = `${d.brandNameEn} ${name} ECU Tuning | Specs and Options`;
  const o = computeOutputs(d.stockOutput, d.stage1Gain);
  const quote = d.en.mode === "quote";

  const ld = jsonLd({
    "@context": "https://schema.org",
    "@type": "Service",
    name: `${d.brandNameEn} ${name} ECU Tuning`,
    provider: { "@type": "AutoRepair", name: "mbFAST Tuning", address: { "@type": "PostalAddress", addressCountry: "JP" } },
    description:
      o && o.tunedPs !== null
        ? `ECU tuning for the ${d.brandNameEn} ${name}: ${o.stockPs}ps stock to ${o.tunedPs}ps. Pops and bangs and more, developed in Japan.`
        : `ECU tuning and pops and bangs for the ${d.brandNameEn} ${name}, developed in Japan.`,
  });

  const priceSection = quote
    ? `<h2>Pricing</h2>
<p class="vpg-sub">Pricing for international customers is provided by individual quote. Tell us your car and what you want it to do.</p>`
    : `<h2>Pricing</h2>
${priceTable((d.en as { mode: "price"; prices: PriceItem[] }).prices, false, true)}`;

  const html = `<!-- wp:html -->
${MARK_START}
${css(true)}
<div class="vpg-wrap">
<div class="vpg-kicker">${esc(d.brandNameEn)} ECU TUNING — JAPAN</div>
<div class="vpg-hero"><h1>${esc(name)}<br>ECU Tuning and Pops and Bangs</h1></div>
<p class="vpg-sub">Engine: ${esc(d.engine)}${d.ecuType ? `　ECU: ${esc(d.ecuType)}` : ""}</p>
${powerCards(d, { stock: "Stock", tuned: "Tuned", ps: "Power", tq: "Torque" })}
<h2>Vehicle Specs</h2>
<table class="vpg-table"><tbody>
${specRows(d, false)}
</tbody></table>
${priceSection}
${customerRemoteBadges(d) ? `<h2>Remote Tuning</h2>\n<p class="vpg-sub">We ship the flashing device to you — no visit required.</p>\n${customerRemoteBadges(d)}` : ""}
${optionTable(d, false) ? `<h2>Available Options</h2>\n${optionTable(d, false)}` : ""}
${relatedList(d) ? `<h2>Our Work on This Model</h2>\n${relatedList(d)}` : ""}
<div class="vpg-cta">
<p>Tuning files developed and proven in Japan. Remote tuning available worldwide.</p>
<a href="${LINE_URL}" target="_blank" rel="noopener">Request a Quote</a>
</div>
${dealerBlock(d, false)}
<p class="vpg-note">Specifications subject to change. Output gains vary by vehicle condition and fuel.</p>
</div>
${COUNT_SCRIPT}
<script type="application/ld+json">${ld}</script>
${MARK_END}
<!-- /wp:html -->`;
  return { title, html };
}
