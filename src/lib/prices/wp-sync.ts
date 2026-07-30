/*
 * 価格表 → WordPress の反映（同期エンジン）。
 *
 * 大前提: **本番の現在の内容が正**。生成結果が本番と一致することを確認してから書き込む。
 * 昨日、19ブランドの工賃列の並びを人が手作業で直している。列順ルールが生成側とズレたまま
 * 同期すると、その作業が一度に巻き戻る。だからこのモジュールは
 *
 *   1) 既定は読み取りのみ（diff）。書き込みは明示的に apply したときだけ
 *   2) 列順（thead）が本番と違うブランドは、apply でも**書き込まない**
 *   3) REST保存で壊れるHTML（<script> 内のアンパサンド）は書き込む前に弾く
 *
 * を守る。
 *
 * REST保存の既知の癖:
 *   本文中のアンパサンドが数値参照(&#038;)に変換される。HTMLの属性値では実害が無いが、
 *   JavaScript の中では論理AND演算子やクエリ文字列が壊れる（mbPITのフィードで実害あり）。
 *   → 生成側でアンパサンドを書かない。どうしても必要なら String.fromCharCode(38) で組む。
 */
import { fetchPageRaw, updatePageContent } from "./wordpress";

/** <script>…</script> の中身（JSON-LD も含む。どちらもREST保存で壊れる） */
export function scriptBodies(html: string): string[] {
  const out: string[] = [];
  const re = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) out.push(m[1]);
  return out;
}

/**
 * REST経由で保存して壊れないHTMLか。
 * <script> 内にアンパサンドがあれば false（保存時に &#038; へ変換されてJSが壊れる）。
 */
export function restSafe(html: string): { ok: boolean; reason?: string } {
  for (const body of scriptBodies(html)) {
    const i = body.indexOf("&");
    if (i >= 0) {
      const around = body.slice(Math.max(0, i - 40), i + 40).replace(/\s+/g, " ");
      return {
        ok: false,
        reason: `<script> 内にアンパサンドがあります（REST保存で &#038; に変換され壊れます）: …${around}…`,
      };
    }
  }
  return { ok: true };
}

/** thead の列見出しを順番どおりに取り出す（タグと空白を落として比較用に正規化） */
export function headerCells(html: string): string[] {
  const thead = /<thead[\s\S]*?<\/thead>/i.exec(html)?.[0] ?? "";
  return [...thead.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map((m) =>
    m[1]
      .replace(/<[^>]+>/g, "")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, "")
      .trim(),
  );
}

/** 行数（tbody の tr） */
export function rowCount(html: string): number {
  const tbody = /<tbody[\s\S]*?<\/tbody>/i.exec(html)?.[0] ?? "";
  return [...tbody.matchAll(/<tr\b/gi)].length;
}

export type BrandDiff = {
  brandId: string;
  displayName: string;
  pageId: number | null;
  /** 生成できなかった・ページ未設定などで比較できない */
  skipped?: string;
  live: { headers: string[]; rows: number; bytes: number };
  next: { headers: string[]; rows: number; bytes: number };
  /** 列順が一致しているか（不一致なら apply でも書き込まない） */
  headersMatch: boolean;
  /** 本文が完全一致（差分なし） */
  identical: boolean;
  /** REST保存で壊れる内容が含まれていないか */
  restSafe: boolean;
  restSafeReason?: string;
};

/**
 * 1ブランドの差分を取る（**書き込まない**）。
 * live 側は WP の content.raw、next 側は generatePriceTableHtml の出力。
 */
export async function diffBrandPage(input: {
  brandId: string;
  displayName: string;
  pageId: number | null;
  nextHtml: string;
}): Promise<BrandDiff> {
  const base: Omit<BrandDiff, "live" | "next" | "headersMatch" | "identical" | "restSafe"> = {
    brandId: input.brandId,
    displayName: input.displayName,
    pageId: input.pageId,
  };
  const safe = restSafe(input.nextHtml);
  const next = {
    headers: headerCells(input.nextHtml),
    rows: rowCount(input.nextHtml),
    bytes: Buffer.byteLength(input.nextHtml),
  };
  if (!input.pageId) {
    return {
      ...base,
      skipped: "WPページIDが未設定です（PriceBrand.wordPressPageId）",
      live: { headers: [], rows: 0, bytes: 0 },
      next,
      headersMatch: false,
      identical: false,
      restSafe: safe.ok,
      restSafeReason: safe.reason,
    };
  }
  const page = await fetchPageRaw(input.pageId);
  const live = {
    headers: headerCells(page.raw),
    rows: rowCount(page.raw),
    bytes: Buffer.byteLength(page.raw),
  };
  return {
    ...base,
    live,
    next,
    headersMatch: live.headers.join("|") === next.headers.join("|"),
    identical: page.raw === input.nextHtml,
    restSafe: safe.ok,
    restSafeReason: safe.reason,
  };
}

/**
 * 実際に書き込む。**列順が本番と一致していない／REST非安全なら書き込まない**。
 * force は「列順の違いを承知の上で本番を書き換える」ときだけ使う（人が判断する）。
 */
export async function applyBrandPage(
  diff: BrandDiff,
  nextHtml: string,
  opts: { force?: boolean } = {},
): Promise<{ ok?: true; skipped?: string; error?: string }> {
  if (!diff.pageId) return { skipped: "WPページIDが未設定" };
  if (!diff.restSafe) return { error: diff.restSafeReason ?? "REST保存で壊れる内容です" };
  if (diff.identical) return { skipped: "差分なし" };
  if (!diff.headersMatch && !opts.force) {
    return {
      skipped:
        "列順が本番と一致しません（手作業の並び替えを巻き戻す恐れがあるため書き込みません）。" +
        "生成側のルールを直すか、意図した変更であれば force を指定してください。",
    };
  }
  await updatePageContent(diff.pageId, nextHtml);
  return { ok: true };
}
