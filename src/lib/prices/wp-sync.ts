/*
 * 価格表 → WordPress の反映（同期エンジン）。
 *
 * 大前提: **本番の現在の内容が正**。生成結果が本番と一致することを確認してから書き込む。
 * 19ブランドの工賃列の並びは人が手作業で直している。列順ルールが生成側とズレたまま
 * 同期すると、その作業が一度に巻き戻る。だからこのモジュールは
 *
 *   1) 既定は読み取りのみ（diff）。書き込みは明示的に apply したときだけ
 *   2) 列順（thead）が本番と違うブランドは、apply でも**書き込まない**
 *   3) **ページ全文ではなく貼り付け区間だけを差し替える**
 *      （1ページに2つの表があるケースがある: ベンツのガソリンとディーゼル。
 *        全文置換すると片方が消える。Audiのようにページ内に別の表がある例もある）
 *   4) REST保存で壊れるHTML（<script> 内のアンパサンド）は書き込む前に弾く
 *
 * を守る。
 *
 * REST保存の既知の癖:
 *   本文中のアンパサンドが数値参照(&#038;)に変換される。HTMLの属性値では実害が無いが、
 *   JavaScript の中では論理AND演算子やクエリ文字列が壊れる（mbPITのフィードで実害あり）。
 *   → 生成側でアンパサンドを書かない。どうしても必要なら String.fromCharCode(38) で組む。
 */
import { fetchPageRaw, updatePageContent } from "./wordpress";

/** 貼り付け区間のマーカー（テンプレートが必ず出力する） */
export const MARK_START = "<!-- START: 貼り付け範囲 -->";
export const MARK_END = "<!-- END: 貼り付け範囲 -->";

export type Region = {
  /** マーカーを含む全体（置換に使う） */
  whole: string;
  /** マーカーの内側 */
  inner: string;
  /** whole の開始位置 */
  index: number;
};

/** ページ内の貼り付け区間をすべて取り出す（0個なら空配列） */
export function findRegions(html: string): Region[] {
  const out: Region[] = [];
  let from = 0;
  for (;;) {
    const s = html.indexOf(MARK_START, from);
    if (s === -1) break;
    const e = html.indexOf(MARK_END, s);
    if (e === -1) break;
    const end = e + MARK_END.length;
    out.push({ whole: html.slice(s, end), inner: html.slice(s + MARK_START.length, e), index: s });
    from = end;
  }
  return out;
}

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

/** 行数（最初の tbody の tr） */
export function rowCount(html: string): number {
  const tbody = /<tbody[\s\S]*?<\/tbody>/i.exec(html)?.[0] ?? "";
  return [...tbody.matchAll(/<tr\b/gi)].length;
}

/**
 * 同じページに複数の区間があるときに、どれがこのブランドの区間かを内容で決める。
 *
 * 目印は「そのブランドにしか出てこない列見出し」。ページを共有する相手の見出しを
 * 引数で渡し、こちらだけに有る見出しを目印にする（例: ディーゼル=アドブルーカット、
 * ガソリン=Stage1.5(バブ無料)）。IDやクラスでは区別できない（ベンツは両方 mbTable で同一）。
 */
export function distinctiveHeaders(mine: string[], others: string[][]): string[] {
  const otherSet = new Set(others.flat());
  return mine.filter((h) => h && !otherSet.has(h));
}

export type RegionPick =
  | { ok: true; region: Region }
  | { ok: false; reason: string };

export function pickRegion(regions: Region[], fingerprints: string[]): RegionPick {
  if (regions.length === 0) {
    return {
      ok: false,
      reason: `本番のページに貼り付け区間のマーカー（${MARK_START}）がありません。何を置き換えるか特定できないため書き込みません`,
    };
  }
  if (regions.length === 1) return { ok: true, region: regions[0] };
  if (fingerprints.length === 0) {
    return {
      ok: false,
      reason: `ページに区間が${regions.length}個あり、このブランドを見分ける目印（他ブランドに無い列見出し）が作れません`,
    };
  }
  const hits = regions.filter((r) => {
    const heads = headerCells(r.inner);
    return fingerprints.some((f) => heads.includes(f));
  });
  if (hits.length === 1) return { ok: true, region: hits[0] };
  return {
    ok: false,
    reason:
      hits.length === 0
        ? `ページに区間が${regions.length}個ありますが、目印（${fingerprints.join(" / ")}）を含む区間が見つかりません`
        : `目印を含む区間が${hits.length}個あり、どれを置き換えるか決められません`,
  };
}

export type BrandDiff = {
  brandId: string;
  displayName: string;
  pageId: number | null;
  /** 比較できない（ページ未設定・区間が特定できない等） */
  skipped?: string;
  /** 本番ページ全体（apply で区間だけ差し替えるために保持） */
  liveRaw?: string;
  /** 置き換え対象の区間 */
  liveRegion?: Region;
  regionCount: number;
  live: { headers: string[]; rows: number; bytes: number };
  next: { headers: string[]; rows: number; bytes: number };
  headersMatch: boolean;
  identical: boolean;
  restSafe: boolean;
  restSafeReason?: string;
};

/**
 * 1ブランドの差分を取る（**書き込まない**）。
 * 比較は「本番の該当区間」と「生成HTMLの区間」で行う（ページ全体では比べない）。
 */
export async function diffBrandPage(input: {
  brandId: string;
  displayName: string;
  pageId: number | null;
  nextHtml: string;
  /** 同じページを共有する他ブランドの列見出し（区間の同定に使う） */
  otherHeaders?: string[][];
}): Promise<BrandDiff> {
  const nextRegions = findRegions(input.nextHtml);
  const nextRegion = nextRegions[0];
  const nextInner = nextRegion?.inner ?? input.nextHtml;
  const next = {
    headers: headerCells(nextInner),
    rows: rowCount(nextInner),
    bytes: Buffer.byteLength(nextInner),
  };
  const safe = restSafe(input.nextHtml);
  const base = {
    brandId: input.brandId,
    displayName: input.displayName,
    pageId: input.pageId,
    regionCount: 0,
    next,
    restSafe: safe.ok,
    restSafeReason: safe.reason,
  };
  const empty = { headers: [] as string[], rows: 0, bytes: 0 };

  if (!input.pageId) {
    return {
      ...base,
      skipped: "WPページIDが未設定です（PriceBrand.wordPressPageId）",
      live: empty,
      headersMatch: false,
      identical: false,
    };
  }
  if (!nextRegion) {
    return {
      ...base,
      skipped: `生成HTMLに貼り付け区間のマーカーがありません（テンプレートの不具合）`,
      live: empty,
      headersMatch: false,
      identical: false,
    };
  }

  const page = await fetchPageRaw(input.pageId);
  const regions = findRegions(page.raw);
  const picked = pickRegion(
    regions,
    distinctiveHeaders(next.headers, input.otherHeaders ?? []),
  );
  if (!picked.ok) {
    return {
      ...base,
      regionCount: regions.length,
      skipped: picked.reason,
      liveRaw: page.raw,
      live: empty,
      headersMatch: false,
      identical: false,
    };
  }
  const liveInner = picked.region.inner;
  return {
    ...base,
    regionCount: regions.length,
    liveRaw: page.raw,
    liveRegion: picked.region,
    live: {
      headers: headerCells(liveInner),
      rows: rowCount(liveInner),
      bytes: Buffer.byteLength(liveInner),
    },
    headersMatch: headerCells(liveInner).join("|") === next.headers.join("|"),
    identical: liveInner === nextRegion.inner,
  };
}

/**
 * 実際に書き込む。**該当区間だけ**を差し替え、ページの他の内容には触らない。
 * 列順が本番と一致していない／REST非安全なら書き込まない。
 * force は「列順の違いを承知の上で本番を書き換える」ときだけ使う（人が判断する）。
 */
export async function applyBrandPage(
  diff: BrandDiff,
  nextHtml: string,
  opts: { force?: boolean } = {},
): Promise<{ ok?: true; skipped?: string; error?: string }> {
  if (!diff.pageId) return { skipped: "WPページIDが未設定" };
  if (diff.skipped) return { skipped: diff.skipped };
  if (!diff.restSafe) return { error: diff.restSafeReason ?? "REST保存で壊れる内容です" };
  if (diff.identical) return { skipped: "差分なし" };
  if (!diff.headersMatch && !opts.force) {
    return {
      skipped:
        "列順が本番と一致しません（手作業の並び替えを巻き戻す恐れがあるため書き込みません）。" +
        "生成側のルールを直すか、意図した変更であれば force を指定してください。",
    };
  }
  if (!diff.liveRaw || !diff.liveRegion) return { error: "本番の区間を特定できていません" };

  const nextRegion = findRegions(nextHtml)[0];
  if (!nextRegion) return { error: "生成HTMLに貼り付け区間がありません" };

  // 区間の外（他の表・説明文・別ブランドの表）はそのまま残す
  const updated =
    diff.liveRaw.slice(0, diff.liveRegion.index) +
    nextRegion.whole +
    diff.liveRaw.slice(diff.liveRegion.index + diff.liveRegion.whole.length);

  // 置き換え後のページ全体も念のため検査する（他の区間に & が残っていても壊れるため）
  const safe = restSafe(updated);
  if (!safe.ok) return { error: `置き換え後のページが安全ではありません: ${safe.reason}` };

  await updatePageContent(diff.pageId, updated);
  return { ok: true };
}
