/*
 * GoogleマップURL → 座標 の解析を検証する（ネットワーク非依存・純関数のみ）。
 *
 *   npm run check:store-geo
 *
 * 短縮URL（maps.app.goo.gl）はリダイレクトを辿らないと座標が入っていないため、
 * ここでは「展開が必要」と判定できることだけを確かめる（展開自体は store-geo.ts）。
 */

import { isInJapan, isShortMapUrl, mapUrlOf, parseLatLng } from "../src/lib/geo/gmap";

type Case = { name: string; input: string; want: { lat: number; lng: number } | null };

const CASES: Case[] = [
  {
    name: "place URL（!3d!4d を優先＝地図中心ではなく地物の座標）",
    input:
      "https://www.google.com/maps/place/%E6%B8%8B%E8%B0%B7/@35.6580,139.7010,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d35.659500!4d139.700500",
    want: { lat: 35.6595, lng: 139.7005 },
  },
  {
    name: "@lat,lng,zoom のみ",
    input: "https://www.google.com/maps/place/mbFAST/@35.661234,139.698765,18z",
    want: { lat: 35.661234, lng: 139.698765 },
  },
  { name: "?q=lat,lng", input: "https://www.google.com/maps?q=34.670900,135.500000", want: { lat: 34.6709, lng: 135.5 } },
  { name: "?ll=lat,lng", input: "https://maps.google.com/?ll=33.589800,130.401700", want: { lat: 33.5898, lng: 130.4017 } },
  { name: "座標を直接貼った場合", input: "35.6595,139.7005", want: { lat: 35.6595, lng: 139.7005 } },
  { name: "座標（空白あり）", input: " 35.6595 , 139.7005 ", want: { lat: 35.6595, lng: 139.7005 } },
  { name: "短縮URL（座標は入っていない）", input: "https://maps.app.goo.gl/AbCdEfGhIjK", want: null },
  { name: "座標を含まないURL", input: "https://www.google.com/maps/place/%E6%B8%8B%E8%B0%B7%E9%A7%85/", want: null },
  { name: "空文字", input: "", want: null },
  { name: "緯度が範囲外（値として不正）", input: "935.6595,139.7005", want: null },
];

let failed = 0;
const eq = (a: number, b: number) => Math.abs(a - b) < 1e-9;

for (const c of CASES) {
  const got = parseLatLng(c.input);
  const ok =
    c.want === null
      ? got === null
      : got !== null && eq(got.lat, c.want.lat) && eq(got.lng, c.want.lng);
  if (!ok) {
    failed++;
    console.error(`  NG  ${c.name}\n      期待: ${JSON.stringify(c.want)}\n      実際: ${JSON.stringify(got)}`);
  } else {
    console.log(`  OK  ${c.name}`);
  }
}

// 短縮URLの判定
for (const [url, want] of [
  ["https://maps.app.goo.gl/xxxx", true],
  ["https://goo.gl/maps/xxxx", true],
  ["https://www.google.com/maps/place/x/@35.1,139.1,17z", false],
] as const) {
  const got = isShortMapUrl(url);
  if (got !== want) {
    failed++;
    console.error(`  NG  短縮URL判定: ${url} 期待=${want} 実際=${got}`);
  } else {
    console.log(`  OK  短縮URL判定: ${url} → ${got}`);
  }
}

// 日本の範囲判定（緯度経度の取り違えを弾けること）
for (const [pos, want] of [
  [{ lat: 35.6595, lng: 139.7005 }, true],
  [{ lat: 139.7005, lng: 35.6595 }, false], // 入れ替え
  [{ lat: 48.8584, lng: 2.2945 }, false], // パリ
] as const) {
  const got = isInJapan(pos);
  if (got !== want) {
    failed++;
    console.error(`  NG  日本範囲判定: ${JSON.stringify(pos)} 期待=${want} 実際=${got}`);
  } else {
    console.log(`  OK  日本範囲判定: ${JSON.stringify(pos)} → ${got}`);
  }
}

// 生成リンク
const link = mapUrlOf({ lat: 35.6595, lng: 139.7005 });
if (link !== "https://www.google.com/maps/search/?api=1&query=35.6595,139.7005") {
  failed++;
  console.error(`  NG  リンク生成: ${link}`);
} else {
  console.log(`  OK  リンク生成: ${link}`);
}

if (failed > 0) {
  console.error(`\n${failed} 件失敗しました。`);
  process.exit(1);
}
console.log("\nすべて通りました。");
