/*
 * 車両ページのローカルプレビュー（DB不要・WP不要）。
 * サンプルデータで JP/EN のHTMLを .verify-out/ に書き出す。デザイン確認用。
 *
 *   npm run vpages:preview
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { generateVehiclePageEn, generateVehiclePageJp } from "../src/lib/vehicle-pages/generate-html";
import type { VehiclePageData } from "../src/lib/vehicle-pages/types";
import { FALLBACK_OPTION_DEFS } from "../src/lib/vehicle-pages/options";

const sample: VehiclePageData = {
  slug: "c-w204-c63amg",
  brandDisplayName: "メルセデス・ベンツ",
  brandNameEn: "Mercedes-Benz",
  brandSlug: "mercedes",
  carName: "C(W204)",
  grade: "C63AMG",
  engine: "M156",
  ecuType: "ME9.7",
  stockOutput: "457ps/600Nm",
  stage1Gain: "+53ps/50Nm",
  prices: [
    { key: "babble", label: "バブリングのみ", value: "110000" },
    { key: "stage1", label: "Stage1", value: "143000" },
    { key: "stage15", label: "Stage1.5", value: "165000" },
    { key: "stage2", label: "Stage2", value: "198000" },
    { key: "tcu", label: "TCUチューニング", value: "ASK" },
  ],
  labor: null,
  remote: { flasher: true, autoTuner: true },
  notes: null,
  options: {
    babble: true,
    coldStartOff: true,
    idlingStopOff: false,
    mapSwitch: false,
    limiterCut: true,
  },
  related: [
    {
      title: "【施工記録】BMW X5M Competition ECUチューニング＋バブリング（フォーマット参考・実データはC63記事に差し替え）",
      url: "https://mbfasttuning.com/mbpit/mbfast-tuning/bmw-x5m-competition-ecu-tuning-20260808/",
    },
  ],
  optionDefs: FALLBACK_OPTION_DEFS,
  en: { mode: "quote" },
};

mkdirSync(".verify-out", { recursive: true });
const jp = generateVehiclePageJp(sample);
const en = generateVehiclePageEn(sample);

// wp:html コメントを外してブラウザでそのまま見られる形に
const wrap = (title: string, html: string) =>
  `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="margin:0;background:#f0f0f0">${html.replace(/<!-- \/?wp:html -->/g, "")}</body></html>`;

writeFileSync(".verify-out/vpage-preview-jp.html", wrap(jp.title, jp.html));
writeFileSync(".verify-out/vpage-preview-en.html", wrap(en.title, en.html));
console.log("書き出し: .verify-out/vpage-preview-jp.html / vpage-preview-en.html");
console.log(`JP title: ${jp.title}`);
console.log(`EN title: ${en.title}`);
