/*
 * ダウンロード用ファイル名の構造化生成。
 * 規則: 「車種(世代) Cal ツール_method_内容.ext」。※メーカー名は含めない。
 *   例: RS3(8V) 8V0907404_0004 AT_OBD_ori.bin
 *       RS3(8V) 8V0907404_0004 AT_OBD_Stage1_Pops_Adblue.slave
 */

// ファイル名に使えない文字を除去（スペース・括弧・アンダースコアは許可）
function clean(s: string | null | undefined): string {
  return (s ?? "").replace(/[\/\\:*?"<>|]+/g, "").trim();
}

export function buildDownloadName(opts: {
  model: string | null | undefined;
  generation?: string | null;
  cal?: string | null;
  method?: string | null;
  content: string; // "ori" や "Stage1_Pops_Adblue" 等
  ext: string; // "bin" / "slave" 等（先頭ドット不要）
  tool?: string; // 既定 "AT"
  // 記録紐づきDL用。車種名の後に「代理店名(顧客名+日付)」を入れる。
  dealerName?: string | null;
  customerName?: string | null;
  dateLabel?: string | null; // 例 2026-06-10
}): string {
  const model = clean(opts.model) || "unknown";
  const gen = clean(opts.generation);
  const cal = clean(opts.cal); // 空なら省略（代理店向けは Cal を出さない）
  const tool = clean(opts.tool) || "AT";
  const method = clean(opts.method) || "NA";
  const content = clean(opts.content) || "file";
  const ext = (opts.ext || "bin").replace(/^\.+/, "");
  const head = gen ? `${model}(${gen})` : model;

  // 代理店名(顧客名+日付) セグメント（車種名の直後）
  const dealerName = clean(opts.dealerName);
  let dealerSeg = "";
  if (dealerName) {
    // ()内はスペースを入れない（顧客名のスペースも詰める）
    const inner = [clean(opts.customerName), clean(opts.dateLabel)]
      .filter(Boolean)
      .join("+")
      .replace(/\s+/g, "");
    dealerSeg = ` ${dealerName}${inner ? `(${inner})` : ""}`;
  }

  return `${head}${dealerSeg}${cal ? ` ${cal}` : ""} ${tool}_${method}_${content}.${ext}`;
}

// 日付を YYYY-MM-DD（ファイル名安全）に整形
export function dateLabel(d: Date | null | undefined): string {
  if (!d) return "";
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// TunedVariant の内容文字列（stage + Pops + optionTags）
export function composeContent(
  stage: string | null | undefined,
  popsAndBangs: boolean,
  optionTags: string[] = [],
  popsSport = false,
): string {
  const parts = [
    clean(stage) || null,
    popsAndBangs ? (popsSport ? "PopsSport" : "Pops") : null,
    ...optionTags.map((t) => clean(t)).filter(Boolean),
  ].filter(Boolean) as string[];
  return parts.length ? parts.join("_") : "tuned";
}

// Content-Disposition ヘッダ値を組み立てる。
// RFC 5987/6266 準拠: filename*（UTF-8厳密エンコード）に加え、ASCII の filename= も付与。
// encodeURIComponent は ( ) * ' を素のまま残すが、これらは ext-value で不正なため、
// 厳密ブラウザ(Safari等)が filename* を丸ごと破棄し、URL末尾(例 "decrypted")を
// 拡張子なしで保存してしまう。両対応で確実に正しい名前・拡張子で保存させる。
export function contentDisposition(filename: string): string {
  const utf8 = encodeURIComponent(filename).replace(
    /['()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase(),
  );
  // ASCII フォールバック（非ASCII→_、ダブルクオート/バックスラッシュ除去）。拡張子は保持される。
  const ascii = filename
    .replace(/[^\x20-\x7E]/g, "_")
    .replace(/["\\]/g, "_")
    .trim();
  return `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

// 保存キー/ファイル名から拡張子を取り出す（先頭ドットなし。無ければ既定）
export function extFromName(name: string | null | undefined, fallback = "bin"): string {
  if (!name) return fallback;
  const m = name.match(/\.([A-Za-z0-9]{1,8})$/);
  return m ? m[1] : fallback;
}
