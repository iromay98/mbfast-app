/*
 * mbPIT 店舗slug規則と店舗ページ雛形の差し替えロジックの検査（DB・WP不要）。
 * 規則: src/server/pit/store-slug.ts ／ 雛形差し替え: wordpress.ts renderStorePageContent
 */
const { normalizeStoreSlug, isValidStoreSlug, suggestStoreSlug } = await import("../src/server/pit/store-slug");
const { renderStorePageContent } = await import("../src/server/pit/wordpress");

let bad = 0;
const eq = (label: string, got: unknown, want: unknown) => {
  if (got !== want) {
    bad++;
    console.error(`NG ${label}: got=${JSON.stringify(got)} want=${JSON.stringify(want)}`);
  }
};

// 接尾辞は剥がす（過去の失敗例）
eq("glanzcoat-mbpit", normalizeStoreSlug("glanzcoat-mbpit"), "glanzcoat");
eq("ons-mbpit", normalizeStoreSlug("ons-mbpit"), "ons");
eq("reboot-tipo-dealer", normalizeStoreSlug("reboot-tipo-dealer"), "reboot-tipo");
eq("tfactory-dealer", normalizeStoreSlug("tfactory-dealer"), "tfactory");
eq("多重接尾辞", normalizeStoreSlug("foo-mbpit-dealer"), "foo");
// 区切りはハイフン・小文字
eq("MCC Complete", normalizeStoreSlug("MCC Complete"), "mcc-complete");
eq("MCC-Complete", normalizeStoreSlug("MCC-Complete"), "mcc-complete");
eq("On's", normalizeStoreSlug("On's"), "ons");
eq("Charism_Garage", normalizeStoreSlug("Charism_Garage"), "charism-garage");
eq("Café Auto", normalizeStoreSlug("Café Auto"), "cafe-auto");
// 日本語のみは候補なし
eq("日本語", suggestStoreSlug("コーティングショップ プログレス"), "");
eq("valid", isValidStoreSlug("charism-garage"), true);
eq("invalid suffix", isValidStoreSlug("glanzcoat-mbpit"), false);
eq("too short", isValidStoreSlug("ab"), false);

// 雛形差し替え（ユウキロジ 661 → テスト店 999）
const tpl = [
  '<h1>ユウキロジ</h1>',
  '{"name": "ユウキロジ", "url": "https://mbfasttuning.com/mbpit/yuukilogi/"}',
  "x.open('GET','/wp-json/wp/v2/categories/661?_fields=count',true);",
  '<!-- wp:query {"queryId":62,"query":{"taxQuery":{"category":[661]}}} -->',
  '<h2>ユウキロジの施工記録</h2>',
  ".a{width:661px}",
].join("\n");
const out = renderStorePageContent(tpl, { name: 'Test & Co "X"', slug: "test-co", categoryId: 999 });
eq("店名h1", out.includes('<h1>Test &amp; Co "X"</h1>'), true);
eq("JSON-LD name", out.includes('"name": "Test & Co \\"X\\""'), true);
eq("URL", out.includes("/mbpit/test-co/"), true);
eq("count api", out.includes("/categories/999?"), true);
eq("query cat", out.includes('"category":[999]'), true);
eq("queryId", out.includes('"queryId":10999'), true);
eq("CSSの数値は触らない", out.includes("width:661px"), true);
eq("雛形の店名が残らない", out.includes("ユウキロジ"), false);
eq("雛形のslugが残らない", out.includes("yuukilogi"), false);

if (bad) {
  console.error(`check:store-slug NG ${bad}件`);
  process.exit(1);
}
console.log("check:store-slug OK");
