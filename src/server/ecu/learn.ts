/*
 * ECU識別子(HW/SW/Cal)の「学習」— すべてローカル処理（外部API不要）。
 *
 * - EXACT: 手入力した値を、そのファイルの内容hashに紐づけて記憶。同じ純正が来たら即返す。
 * - MARKER: 手入力した値を復号binの中から探し、「直前の目印＋トークンの形」を覚えて
 *           同系ECUの新しいファイルにも適用する。
 *     HW / SW … 単一トークンをそのまま学習。
 *     CAL …… 複合値 "SW_バージョン" を、SW部分(SWマーカー)＋バージョン部分(CALVERマーカー)に
 *             分けて学習し、新ファイルでは Cal = SW + "_" + バージョン を組み立てる。
 *
 * 識別子は復号後binの中にあり、その bin は既に手元にある（APIは復号時のみで実施済み）。
 */

import { prisma } from "@/lib/db";
import { extractEcuId, type EcuId } from "@/server/ecu/identify";
import { isMercedes } from "@/lib/catalog/manufacturers";

type Field = "HW" | "SW" | "CAL";

function clean(buf: Buffer): string {
  return buf.toString("latin1").replace(/[^\x20-\x7E]/g, " ");
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// トークンの「形」を一般化した正規表現にする（数字→\d, 英大→[A-Z], 英小→[a-z]）。
function shapeRegex(token: string): string {
  let out = "";
  for (const ch of token) {
    if (/[0-9]/.test(ch)) out += "\\d";
    else if (/[A-Z]/.test(ch)) out += "[A-Z]";
    else if (/[a-z]/.test(ch)) out += "[a-z]";
    else out += escapeRe(ch);
  }
  return out;
}

// idx 位置のトークンの直前にある非空白の塊（2〜14文字）を目印に。
function markerBefore(cleaned: string, idx: number): string | null {
  const pre = cleaned.slice(Math.max(0, idx - 16), idx);
  return pre.match(/(\S{2,14})\s*$/)?.[1] ?? null;
}

// bin の中から value（または先頭トークン）を探し、直前の目印＋形を導く。
function deriveMarker(cleaned: string, value: string): { before: string; regex: string } | null {
  let token = value;
  let idx = cleaned.indexOf(token);
  if (idx < 0) {
    token = value.split(/[_\s/]/)[0];
    if (token.length < 4) return null;
    idx = cleaned.indexOf(token);
    if (idx < 0) return null;
  }
  const before = markerBefore(cleaned, idx);
  if (!before) return null;
  return { before, regex: shapeRegex(token) };
}

// バージョン(ver)を SW 近傍で探し、その目印＋形を導く（誤検出を避けるため SW の近くを優先）。
function deriveVerMarker(
  cleaned: string,
  swPart: string,
  ver: string,
): { before: string; regex: string } | null {
  const swIdx = cleaned.indexOf(swPart);
  // SW の後ろ 80 文字以内に出てくる ver を採用。無ければ全体から最初の出現。
  let idx = -1;
  if (swIdx >= 0) {
    const local = cleaned.slice(swIdx, swIdx + 80).indexOf(ver);
    if (local >= 0) idx = swIdx + local;
  }
  if (idx < 0) idx = cleaned.indexOf(ver);
  if (idx < 0) return null;
  const before = markerBefore(cleaned, idx);
  if (!before) return null;
  return { before, regex: shapeRegex(ver) };
}

// MARKER ルールを重複なく保存。
async function storeMarker(
  field: string,
  matchKey: string,
  before: string,
  regex: string,
  value: string,
  sourceBaseFileId?: string | null,
): Promise<void> {
  const dup = await prisma.ecuRule.findFirst({
    where: { kind: "MARKER", field, matchKey, beforeMarker: before, tokenRegex: regex },
    select: { id: true },
  });
  if (dup) return;
  await prisma.ecuRule.create({
    data: {
      kind: "MARKER",
      field,
      matchKey,
      beforeMarker: before,
      tokenRegex: regex,
      value,
      sourceBaseFileId: sourceBaseFileId ?? null,
    },
  });
}

// 手入力値から EXACT/MARKER ルールを学習・保存。bin が無ければ EXACT のみ。
export async function learnEcuRules(opts: {
  buf: Buffer | null;
  hash: string | null;
  ecuType: string | null;
  hw?: string | null;
  sw?: string | null;
  cal?: string | null;
  sourceBaseFileId?: string | null;
}): Promise<void> {
  const cleaned = opts.buf ? clean(opts.buf) : null;
  const ecuKey = (opts.ecuType ?? "").trim();
  // ECU型式が不明だと、学習した目印が全メーカーに当たって誤認識する（例 BMWに別車種の値）。
  // よって MARKER は ECU型式が分かっている時だけ学習する（EXACT=hash一致は常に可）。
  const realEcu = !!ecuKey && ecuKey !== "(不明)" && ecuKey !== "不明" && ecuKey !== "*";
  const src = opts.sourceBaseFileId ?? null;
  const entries: [Field, string | null | undefined][] = [
    ["HW", opts.hw],
    ["SW", opts.sw],
    ["CAL", opts.cal],
  ];

  for (const [field, raw] of entries) {
    const value = (raw ?? "").trim();
    if (!value) continue;

    // EXACT（内容hash基準）
    if (opts.hash) {
      const existing = await prisma.ecuRule.findFirst({
        where: { kind: "EXACT", field, matchKey: opts.hash },
        select: { id: true },
      });
      if (existing) {
        await prisma.ecuRule.update({ where: { id: existing.id }, data: { value } });
      } else {
        await prisma.ecuRule.create({
          data: { kind: "EXACT", field, matchKey: opts.hash, value, sourceBaseFileId: src },
        });
      }
    }

    // MARKER は ECU型式が分かっている時だけ（不明だと全メーカーに誤適用するため）
    if (!cleaned || !realEcu) continue;

    // MARKER（ECU型式基準）
    if (field === "HW" || field === "SW") {
      const m = deriveMarker(cleaned, value);
      if (m) await storeMarker(field, ecuKey, m.before, m.regex, value, src);
    } else if (field === "CAL") {
      // 複合 "SW_バージョン" を分解。SW部分＋バージョン部分を別々に学習。
      const us = value.indexOf("_");
      const swPart = us >= 0 ? value.slice(0, us) : value;
      const ver = us >= 0 ? value.slice(us + 1) : "";
      if (swPart.length >= 4) {
        const m = deriveMarker(cleaned, swPart);
        if (m) await storeMarker("SW", ecuKey, m.before, m.regex, swPart, src);
      }
      if (ver && /^[A-Za-z0-9]{2,8}$/.test(ver)) {
        const m = deriveVerMarker(cleaned, swPart, ver);
        if (m) await storeMarker("CALVER", ecuKey, m.before, m.regex, ver, src);
      }
    }
  }
}

// 内容hash一致の EXACT 値を引く。
async function lookupExact(hash: string): Promise<Partial<Record<Field, string>>> {
  const rules = await prisma.ecuRule.findMany({
    where: { kind: "EXACT", matchKey: hash },
    select: { field: true, value: true },
  });
  const out: Partial<Record<Field, string>> = {};
  for (const r of rules) if (r.value) out[r.field as Field] = r.value;
  return out;
}

// MARKER ルールを bin に適用（HW/SW/CALVER）。matchKey が ecuType か "*" のものを使う。
async function applyMarkers(
  cleaned: string,
  ecuType: string | null,
): Promise<Record<string, string>> {
  // ECU型式が一致するルールのみ適用（グローバル"*"は誤認識源なので使わない）。
  const key = (ecuType ?? "").trim();
  if (!key || key === "(不明)" || key === "不明" || key === "*") return {};
  const rules = await prisma.ecuRule.findMany({
    where: { kind: "MARKER", matchKey: key },
    orderBy: { updatedAt: "desc" },
    select: { field: true, beforeMarker: true, tokenRegex: true },
  });
  const out: Record<string, string> = {};
  for (const r of rules) {
    if (out[r.field] || !r.beforeMarker || !r.tokenRegex) continue;
    try {
      const re = new RegExp(`${escapeRe(r.beforeMarker)}\\s*(${r.tokenRegex})`);
      const m = cleaned.match(re);
      if (m) out[r.field] = m[1];
    } catch {
      /* 不正な正規表現は無視 */
    }
  }
  return out;
}

// 組み込み抽出＋学習（MARKER）＋確定値（EXACT）をマージ。EXACT が最優先。
export async function smartExtractEcuId(
  buf: Buffer,
  ctx: { hash?: string | null; ecuType?: string | null; manufacturer?: string | null },
): Promise<EcuId> {
  const base = extractEcuId(buf);

  // ベンツは自動認識(組み込み抽出/MARKER)が Cal を誤検出するため一切使わない。
  // 確定値(EXACT＝同一ファイルに本店が確定した値)と手入力のみを使う。
  const benz = isMercedes(ctx.manufacturer);
  if (benz) {
    base.hw = null;
    base.sw = null;
    base.cal = null;
  } else if (!base.hw || !base.sw || !base.cal) {
    // MARKER（組み込みで取れなかった項目だけ補う）
    const cleaned = clean(buf);
    const m = await applyMarkers(cleaned, ctx.ecuType ?? null);
    if (!base.hw && m.HW) base.hw = m.HW;
    if (!base.sw && m.SW) base.sw = m.SW;
    // Cal 再構成: 組み込みが cal を出せていない & sw がある場合
    if (!base.cal && base.sw) {
      base.cal = m.CALVER ? `${base.sw}_${m.CALVER}` : base.sw;
    }
  }

  // EXACT（このファイルに対して本店が確定した値）→ 最優先で上書き
  if (ctx.hash) {
    const ex = await lookupExact(ctx.hash);
    if (ex.HW) base.hw = ex.HW;
    if (ex.SW) base.sw = ex.SW;
    if (ex.CAL) base.cal = ex.CAL;
  }

  return base;
}
