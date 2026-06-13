/*
 * ECU識別子(HW/SW/Cal)の「学習」— すべてローカル処理（外部API不要）。
 *
 * - EXACT: 手入力した値を、そのファイルの内容hashに紐づけて記憶。同じ純正が来たら即返す。
 * - MARKER: 手入力した値を復号binの中から探し、「直前の目印＋トークンの形」を覚えて
 *           同系ECUの新しいファイルにも適用する。
 *
 * 識別子は復号後binの中にあり、その bin は既に手元にある（APIは復号時のみで実施済み）。
 * よって学習・抽出は自前コードで完結する。
 */

import { prisma } from "@/lib/db";
import { extractEcuId, type EcuId } from "@/server/ecu/identify";

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

// bin の中から value（または先頭トークン）を探し、直前の目印＋形を導く。
function deriveMarker(cleaned: string, value: string): { before: string; regex: string } | null {
  let token = value;
  let idx = cleaned.indexOf(token);
  if (idx < 0) {
    // 複合値（例 "X_0002"）は先頭トークンで学習
    token = value.split(/[_\s/]/)[0];
    if (token.length < 4) return null;
    idx = cleaned.indexOf(token);
    if (idx < 0) return null;
  }
  const pre = cleaned.slice(Math.max(0, idx - 16), idx);
  // 直前の非空白の塊（2〜14文字）を目印に
  const before = pre.match(/(\S{2,14})\s*$/)?.[1];
  if (!before) return null;
  return { before, regex: shapeRegex(token) };
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
  const ecuKey = (opts.ecuType ?? "").trim() || "*";
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
          data: {
            kind: "EXACT",
            field,
            matchKey: opts.hash,
            value,
            sourceBaseFileId: opts.sourceBaseFileId ?? null,
          },
        });
      }
    }

    // MARKER（ECU型式基準）。HW/SW のみ（単一トークンで信頼できる）。
    if (cleaned && (field === "HW" || field === "SW")) {
      const m = deriveMarker(cleaned, value);
      if (m) {
        const dup = await prisma.ecuRule.findFirst({
          where: {
            kind: "MARKER",
            field,
            matchKey: ecuKey,
            beforeMarker: m.before,
            tokenRegex: m.regex,
          },
          select: { id: true },
        });
        if (!dup) {
          await prisma.ecuRule.create({
            data: {
              kind: "MARKER",
              field,
              matchKey: ecuKey,
              beforeMarker: m.before,
              tokenRegex: m.regex,
              value,
              sourceBaseFileId: opts.sourceBaseFileId ?? null,
            },
          });
        }
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

// MARKER ルールを bin に適用（HW/SW）。matchKey が ecuType か "*" のものを使う。
async function applyMarkers(
  cleaned: string,
  ecuType: string | null,
): Promise<Partial<Record<Field, string>>> {
  const keys = ["*", ...(ecuType ? [ecuType.trim()] : [])];
  const rules = await prisma.ecuRule.findMany({
    where: { kind: "MARKER", matchKey: { in: keys } },
    orderBy: { updatedAt: "desc" },
    select: { field: true, beforeMarker: true, tokenRegex: true, matchKey: true },
  });
  const out: Partial<Record<Field, string>> = {};
  for (const r of rules) {
    const f = r.field as Field;
    if (out[f] || !r.beforeMarker || !r.tokenRegex) continue;
    try {
      const re = new RegExp(`${escapeRe(r.beforeMarker)}\\s*(${r.tokenRegex})`);
      const m = cleaned.match(re);
      if (m) out[f] = m[1];
    } catch {
      /* 不正な正規表現は無視 */
    }
  }
  return out;
}

// 組み込み抽出＋学習（MARKER）＋確定値（EXACT）をマージ。EXACT が最優先。
export async function smartExtractEcuId(
  buf: Buffer,
  ctx: { hash?: string | null; ecuType?: string | null },
): Promise<EcuId> {
  const base = extractEcuId(buf);

  // MARKER（組み込みで取れなかった項目だけ補う）
  if (!base.hw || !base.sw) {
    const cleaned = clean(buf);
    const m = await applyMarkers(cleaned, ctx.ecuType ?? null);
    if (!base.hw && m.HW) base.hw = m.HW;
    if (!base.sw && m.SW) {
      base.sw = m.SW;
      if (!base.cal) base.cal = m.SW;
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
