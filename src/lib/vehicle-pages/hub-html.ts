// /tuning/（車種から探すハブ）と /tuning/{brand}/（ブランド別の車種一覧）の本文生成。
//
// 目的: 車両ページ群への内部リンクの束を作り、孤島状態を解消する。
//   - ブランドハブ: シリーズ別に公開中の車種ページを一覧（純正→チューニング後出力つき）
//   - ルートハブ: ブランド一覧（公開車種数つき）
// デザインは車両ページと同じ黒基調。マーカー区間方式で、手書きの前書きがあっても壊さない。

import type { DeliveryQuote } from "./delivery";

export type HubVehicleItem = {
  slug: string;
  carName: string;
  grade: string | null;
  stockOutput: string | null;
  tunedPs: string | null; // "510ps" 等（計算済み文字列）
  seriesGroup: string;
  url: string;
};

export type HubBrandItem = {
  displayName: string;
  nameEn: string;
  urlSlug: string;
  url: string;
  count: number;
};

const MARK_START = "<!-- START: 貼り付け範囲 -->";
const MARK_END = "<!-- END: 貼り付け範囲 -->";

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function hubCss(prefix: string): string {
  return `<style>
.${prefix}{background:#0d0d0d;color:#F2F2F2;padding:32px 16px;border-radius:12px}
.${prefix} a{color:#F2F2F2;text-decoration:none}
.${prefix} .hub-lead{color:#bbb;font-size:.92rem;line-height:1.9;max-width:820px;margin:0 auto 1.6rem}
.${prefix} h2{color:#F2F2F2;font-size:1.05rem;border-left:4px solid #EC6420;padding-left:.6em;margin:2rem 0 .8rem}
.${prefix} .hub-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px;list-style:none;margin:0;padding:0}
.${prefix} .hub-card{display:block;border:1px solid #2a2a2a;border-radius:10px;padding:12px 14px;background:#141414;transition:border-color .15s}
.${prefix} .hub-card:hover{border-color:#c9a24b}
.${prefix} .hub-car{font-weight:700;font-size:.95rem}
.${prefix} .hub-grade{color:#c9a24b;font-size:.8rem;margin-top:2px}
.${prefix} .hub-power{color:#bbb;font-size:.78rem;margin-top:6px}
.${prefix} .hub-power b{color:#EC6420;font-weight:700}
.${prefix} .hub-count{color:#777;font-size:.75rem;margin-top:6px}
.${prefix} .hub-links{margin-top:2rem;padding-top:1rem;border-top:1px solid #2a2a2a;font-size:.85rem;display:flex;flex-wrap:wrap;gap:14px}
.${prefix} .hub-links a{color:#c9a24b;text-decoration:underline;text-underline-offset:3px}
.${prefix} .hub-cta{margin-top:1.6rem;padding:16px;border:1px dashed #c9a24b;border-radius:12px;text-align:center}
.${prefix} .hub-cta p{margin:0 0 .7em;color:#bbb;font-size:.85rem}
.${prefix} .hub-cta a{display:inline-block;padding:12px 24px;border-radius:8px;background:#06C755;color:#fff;font-weight:700;text-decoration:none}
.${prefix} .hub-cta a.wa{background:#25D366}
.entry-title,.breadSection{display:none!important}
.siteContent{background:#0d0d0d!important}
</style>`;
}

/** ブランドハブ（/tuning/mercedes-benz/ 等）の本文 */
const LINE_OA_ID = "@755qpqwa";
function inquiryCta(jp: boolean, brandLabel: string): string {
  if (jp) {
    const msg = encodeURIComponent(`【お見積り依頼】\n車種: ${brandLabel}（一覧に無い車種）\n年式・グレード: \nご希望内容: `);
    return `<div class="hub-cta">
<p>一覧に無い車種・年式でも施工できる場合があります。お気軽にご相談ください。</p>
<a href="https://line.me/R/oaMessage/${LINE_OA_ID}/?${msg}" target="_blank" rel="noopener">掲載のない車種を問い合わせる（LINE）</a>
</div>`;
  }
  const wa = encodeURIComponent(`Hi mbFAST, my car is not listed. Can you tune it?\nMake/Model: ${brandLabel} \nYear/Grade: `);
  return `<div class="hub-cta">
<p>Don't see your car? We can often tune models not listed here.</p>
<a class="wa" href="https://wa.me/819067304953?text=${wa}" target="_blank" rel="noopener">Ask about your car on WhatsApp</a>
</div>`;
}

export function buildBrandHubHtml(args: {
  jp: boolean;
  brandDisplayName: string;
  brandNameEn: string;
  vehicles: HubVehicleItem[];
  pricePageUrl: string | null;
  rootUrl: string; // /tuning/ or /en/tuning/
}): string {
  const { jp, brandDisplayName, brandNameEn, vehicles, pricePageUrl, rootUrl } = args;
  const name = jp ? brandDisplayName : brandNameEn;
  const prefix = "vpg-hub";

  // シリーズ別にまとめる（表示順は登場順）
  const bySeries = new Map<string, HubVehicleItem[]>();
  for (const v of vehicles) {
    const key = v.seriesGroup || (jp ? "その他" : "Other");
    if (!bySeries.has(key)) bySeries.set(key, []);
    bySeries.get(key)!.push(v);
  }

  const sections = [...bySeries.entries()]
    .map(([series, items]) => {
      const cards = items
        .map((v) => {
          const power =
            v.stockOutput && v.tunedPs
              ? `<div class="hub-power">${esc(v.stockOutput)} → <b>${esc(v.tunedPs)}</b></div>`
              : v.stockOutput
                ? `<div class="hub-power">${esc(v.stockOutput)}</div>`
                : "";
          return `<li><a class="hub-card" href="${v.url}"><span class="hub-car">${esc(v.carName)}</span>${v.grade ? `<div class="hub-grade">${esc(v.grade)}</div>` : ""}${power}</a></li>`;
        })
        .join("\n");
      return `<h2>${esc(series)}</h2>\n<ul class="hub-grid">\n${cards}\n</ul>`;
    })
    .join("\n");

  const lead = jp
    ? `<p class="hub-lead">${esc(brandDisplayName)}の車種別ECUチューニングデータ一覧です。お車を選ぶと、純正出力・チューニング後の出力・施工価格・対応オプションをご確認いただけます。掲載のない車種・グレードもお気軽にご相談ください。</p>`
    : `<p class="hub-lead">Vehicle-specific ECU tuning data for ${esc(brandNameEn)}. Select your car to see stock and tuned output, pricing and available options. Contact us for models not listed.</p>`;

  const links = [
    pricePageUrl
      ? `<a href="${pricePageUrl}">${jp ? `${esc(brandDisplayName)}の料金を一覧で比較（価格表）` : `${esc(brandNameEn)} full price list`}</a>`
      : "",
    `<a href="${rootUrl}">${jp ? "他のメーカーから探す" : "Browse other makes"}</a>`,
  ]
    .filter(Boolean)
    .join("\n");

  return `${MARK_START}
${hubCss(prefix)}
<div class="${prefix}">
${lead}
${sections}
${inquiryCta(jp, jp ? brandDisplayName : brandNameEn)}
<div class="hub-links">
${links}
</div>
</div>
${MARK_END}`;
}

/** ルートハブ（/tuning/）の本文: ブランド一覧 */
export function buildRootHubHtml(args: { jp: boolean; brands: HubBrandItem[] }): string {
  const { jp, brands } = args;
  const prefix = "vpg-hub";
  const cards = brands
    .filter((b) => b.count > 0)
    .map(
      (b) =>
        `<li><a class="hub-card" href="${b.url}"><span class="hub-car">${esc(jp ? b.displayName : b.nameEn)}</span><div class="hub-count">${b.count}${jp ? "車種" : " models"}</div></a></li>`,
    )
    .join("\n");
  const lead = jp
    ? `<p class="hub-lead">お車のメーカーを選んでください。車種・グレードごとのECUチューニングデータ（純正出力・チューニング後出力・価格・対応オプション）をご覧いただけます。</p>`
    : `<p class="hub-lead">Choose your make to see vehicle-specific ECU tuning data: stock and tuned output, pricing, and available options.</p>`;
  return `${MARK_START}
${hubCss(prefix)}
<div class="${prefix}">
${lead}
<ul class="hub-grid">
${cards}
</ul>
${inquiryCta(jp, jp ? "メーカー・車種" : "")}
</div>
${MARK_END}`;
}

export { MARK_START as HUB_MARK_START, MARK_END as HUB_MARK_END };
