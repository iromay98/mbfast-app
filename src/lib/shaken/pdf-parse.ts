/*
 * 車検証閲覧アプリ（国交省）が出力するPDFから車両情報を取り出す。**DOM非依存・外部依存なし。**
 *
 * なぜAIに投げずに自前で解くのか:
 *  - このPDFは**テキストPDF**（埋め込みフォント＋ToUnicode CMap）なので、文字を確実に復元できる。
 *    車台番号を1文字でも誤ると書類が無効になるため、推測が入り得ないこの経路を第一候補にする
 *  - 氏名・住所が入った書類を外部APIへ送らずに済む
 *  - 費用ゼロ・即時・オフラインで検証できる（テストがネットワークに依存しない）
 *
 * PDFの構造（実物で確認した実装根拠）:
 *  - 文字は1文字ずつ座標指定（Tm/Td）で置かれるため、単純な連結では語がバラバラになる。
 *    y座標でグループ化して行を作り、x昇順で連結して初めて「自動車登録番号」等の語になる
 *  - **ラベル行の次の行に値が並ぶ**2段組。1行に複数ラベルがある場合（例 車両重量／長さ／幅／高さ）は、
 *    値も同じ順で次の行に並ぶので **x座標で列を対応付ける**（テキストの連結順では取り違える）
 *  - Type0フォント＋ToUnicode（bfchar/bfrange）でCID→Unicodeを引く
 *
 * 画像だけのPDF（スキャン等）では文字が取れないので、その場合は呼び出し側がAI読み取りへ回す。
 */

import { inflateSync, inflateRawSync } from "node:zlib";

/** 1文字〜数文字の描画断片（座標付き） */
type Frag = { x: number; y: number; text: string };
/** y座標でまとめた行 */
type Line = { y: number; frags: Frag[]; text: string };

/** 車検証PDFから読み取れた項目（すべて任意。取れなければ空文字） */
export type ShakenPdfFields = {
  registrationNumber: string; // 自動車登録番号又は車両番号
  vin: string; // 車台番号
  makerName: string; // 車名（メーカー名）
  modelCode: string; // 型式
  firstRegistered: string; // 初度登録年月（和暦のまま）
  inspectionExpiry: string; // 有効期間の満了する日（和暦のまま）
  userName: string; // 使用者の氏名又は名称
  userAddress: string; // 使用者の住所
};

// ── PDFの中身を取り出す ────────────────────────────────────────

/** stream…endstream を全部取り出して展開する（展開できないものは捨てる） */
function inflateStreams(pdf: Buffer): string[] {
  const out: string[] = [];
  let i = 0;
  for (;;) {
    const s = pdf.indexOf("stream", i);
    if (s < 0) break;
    let d = s + "stream".length;
    if (pdf[d] === 0x0d) d++;
    if (pdf[d] === 0x0a) d++;
    const e = pdf.indexOf("endstream", d);
    if (e < 0) break;
    const raw = pdf.subarray(d, e);
    let text: string | null = null;
    try {
      text = inflateSync(raw).toString("latin1");
    } catch {
      try {
        text = inflateRawSync(raw).toString("latin1");
      } catch {
        text = null;
      }
    }
    if (text) out.push(text);
    i = e + "endstream".length;
  }
  return out;
}

/** ToUnicode CMap（bfchar/bfrange）から CID → 文字 の対応表を作る */
function buildCidMap(streams: string[]): Map<number, string> {
  const map = new Map<number, string>();
  for (const src of streams) {
    if (!/beginbfchar|beginbfrange/.test(src)) continue;
    for (const m of src.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
      for (const p of m[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
        const units = p[2].match(/.{4}/g);
        if (!units) continue;
        map.set(parseInt(p[1], 16), String.fromCodePoint(...units.map((h) => parseInt(h, 16))));
      }
    }
    for (const m of src.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
      for (const p of m[1].matchAll(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g)) {
        const lo = parseInt(p[1], 16);
        const hi = parseInt(p[2], 16);
        const base = parseInt(p[3], 16);
        // 壊れたCMapで巨大ループにならないように上限を設ける
        if (hi < lo || hi - lo > 65535) continue;
        for (let c = lo; c <= hi; c++) map.set(c, String.fromCodePoint(base + (c - lo)));
      }
    }
  }
  return map;
}

/** コンテンツstreamから座標付きの文字断片を取り出す */
function extractFrags(content: string, cid: Map<number, string>): Frag[] {
  const decodeHex = (hex: string): string => {
    const pairs = hex.replace(/\s+/g, "").match(/.{1,4}/g) ?? [];
    return pairs.map((p) => cid.get(parseInt(p.padEnd(4, "0"), 16)) ?? "").join("");
  };
  const frags: Frag[] = [];
  let x = 0;
  let y = 0;
  // Tm（行列で絶対位置）／Td・TD（相対移動）／Tj・TJ（文字描画）だけを見る
  const re =
    /(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+(-?[\d.]+)\s+Tm|(-?[\d.]+)\s+(-?[\d.]+)\s+(?:Td|TD)|<([0-9A-Fa-f\s]+)>\s*Tj|\[([^\]]*)\]\s*TJ/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    if (m[5] !== undefined && m[6] !== undefined) {
      x = parseFloat(m[5]);
      y = parseFloat(m[6]);
    } else if (m[7] !== undefined && m[8] !== undefined) {
      x += parseFloat(m[7]);
      y += parseFloat(m[8]);
    } else if (m[9] !== undefined) {
      const t = decodeHex(m[9]);
      if (t) frags.push({ x, y, text: t });
    } else if (m[10] !== undefined) {
      let s = "";
      for (const h of m[10].matchAll(/<([0-9A-Fa-f\s]+)>/g)) s += decodeHex(h[1]);
      if (s) frags.push({ x, y, text: s });
    }
  }
  return frags;
}

/** y座標でまとめて行にする（同じ行と見なす許容幅は2pt） */
function buildLines(frags: Frag[]): Line[] {
  const Y_TOLERANCE = 2;
  const sorted = [...frags].sort((a, b) => (Math.abs(a.y - b.y) > Y_TOLERANCE ? b.y - a.y : a.x - b.x));
  const lines: Line[] = [];
  for (const f of sorted) {
    const last = lines[lines.length - 1];
    if (last && Math.abs(last.y - f.y) <= Y_TOLERANCE) last.frags.push(f);
    else lines.push({ y: f.y, frags: [f], text: "" });
  }
  for (const l of lines) {
    l.frags.sort((a, b) => a.x - b.x);
    l.text = l.frags.map((f) => f.text).join("");
  }
  return lines;
}

/** PDF全体を「行の配列」にする。テキストが取れなければ空配列 */
export function pdfToLines(pdf: Buffer): Line[] {
  const streams = inflateStreams(pdf);
  if (streams.length === 0) return [];
  const cid = buildCidMap(streams);
  // 文字描画を含むstreamを全部つなぐ（ページが分かれていても拾う）
  const contents = streams.filter((s) => /\bTj\b|\bTJ\b/.test(s));
  if (contents.length === 0) return [];
  const frags = contents.flatMap((c) => extractFrags(c, cid));
  return buildLines(frags);
}

// ── ラベル→値の対応付け ─────────────────────────────────────────

/*
 * 対応付けの要点: ラベルは「ラベル行」に、値は「その次の行」に、**同じx位置から**始まる。
 * 1行に複数ラベルがある場合（車両重量／長さ／幅／高さ 等）は、
 * 次のラベルのx未満までを自分の値の範囲とする。
 */
const X_SLACK = 6; // 値がラベルよりわずかに左から始まることがあるため許容する

/*
 * このPDFの値は**全角**で入っている（実物で確認: 車台番号が全角17文字、型式のハイフンが全角、
 * 桁の区切りに全角スペース）。NFKCで半角に寄せないと、車台番号の形式チェックも
 * 既存の正規化（normalizeChassis 等）も素通りしてしまう。
 *
 * 空白の扱いは項目で変える:
 *  - 車台番号・型式・日付は空白を**全部除去**（"令和  7年  5月20日" のように字間が空いている）
 *  - 氏名・住所・登録番号は空白を1つに畳む（姓名の区切りや "品川 300 あ 1234" を壊さない）
 */
function nfkc(s: string): string {
  return s.normalize("NFKC");
}
function tightenAll(s: string): string {
  return nfkc(s).replace(/[\s\u3000]+/g, "").trim();
}
function collapseSpaces(s: string): string {
  return nfkc(s).replace(/[\s\u3000]+/g, " ").trim();
}

/** ラベル文字列が現れる行と、その行内でのx位置を返す */
function findLabel(lines: Line[], label: string): { lineIndex: number; x: number } | null {
  for (let i = 0; i < lines.length; i++) {
    const pos = lines[i].text.indexOf(label);
    if (pos < 0) continue;
    // 行内の何文字目かから、対応する断片のxを求める
    let count = 0;
    for (const f of lines[i].frags) {
      if (count + f.text.length > pos) return { lineIndex: i, x: f.x };
      count += f.text.length;
    }
    return { lineIndex: i, x: lines[i].frags[0]?.x ?? 0 };
  }
  return null;
}

/** ラベル行のx位置から、次の行の同じ列にある値を取り出す */
function valueBelow(lines: Line[], label: string, allLabels: string[]): string {
  const found = findLabel(lines, label);
  if (!found) return "";
  const labelLine = lines[found.lineIndex];
  const valueLine = lines[found.lineIndex + 1];
  if (!valueLine) return "";

  // 同じ行にある「自分より右のラベル」のうち最も近いxを、値の右端とする
  let rightBound = Number.POSITIVE_INFINITY;
  for (const other of allLabels) {
    if (other === label) continue;
    const p = labelLine.text.indexOf(other);
    if (p < 0) continue;
    let count = 0;
    for (const f of labelLine.frags) {
      if (count + f.text.length > p) {
        if (f.x > found.x + X_SLACK && f.x < rightBound) rightBound = f.x;
        break;
      }
      count += f.text.length;
    }
  }

  return valueLine.frags
    .filter((f) => f.x >= found.x - X_SLACK && f.x < rightBound)
    .map((f) => f.text)
    .join("")
    .trim();
}

/** 車検証PDFの行データから項目を取り出す */
export function parseShakenPdfLines(lines: Line[]): ShakenPdfFields {
  // 実物のPDFで確認したラベル（表記ゆれに備えて候補を並べ、最初に見つかったものを使う）
  const L = {
    registrationNumber: ["自動車登録番号又は車両番号", "自動車登録番号", "車両番号"],
    vin: ["車台番号"],
    makerName: ["車名"],
    modelCode: ["型式"],
    firstRegistered: ["初度登録年月"],
    inspectionExpiry: ["有効期間の満了する日"],
    userName: ["使用者の氏名又は名称", "使用者の氏名"],
    userAddress: ["使用者の住所"],
  };
  // 列の右端を決めるために、PDFに出る可能性のあるラベルを全部知っておく必要がある
  const ALL = [
    "自動車登録番号又は車両番号", "自動車登録番号", "車両番号", "車台番号", "車名",
    "型式指定番号", "類別区分番号", "型式", "初度登録年月", "交付年月日",
    "使用者の氏名又は名称", "使用者の住所", "使用の本拠の位置", "有効期間の満了する日",
    "所有者の氏名又は名称", "所有者の住所", "原動機の型式", "車体の形状", "乗車定員",
    "最大積載量", "車両重量", "車両総重量", "長さ", "幅", "高さ", "前前軸重", "後後軸重",
    "燃料の種類", "総排気量又は定格出力", "総排気量", "自動車の種別", "用途", "備考",
  ];

  const pick = (candidates: string[]): string => {
    for (const c of candidates) {
      const v = valueBelow(lines, c, ALL);
      if (v) return v;
    }
    return "";
  };

  return {
    // 空白を畳む: 姓名の区切りや "品川 300 あ 1234" の形を保つ
    registrationNumber: collapseSpaces(pick(L.registrationNumber)),
    userName: collapseSpaces(pick(L.userName)),
    userAddress: collapseSpaces(pick(L.userAddress)),
    // 空白を全除去: 字間が空いているだけで、値に空白は含まれない
    vin: tightenAll(pick(L.vin)),
    modelCode: tightenAll(pick(L.modelCode)),
    firstRegistered: tightenAll(pick(L.firstRegistered)),
    inspectionExpiry: tightenAll(pick(L.inspectionExpiry)),
    // 車名はメーカー名。全角を半角に寄せた上で先頭の名称部分だけを採る
    // （同じ行に別の欄が並ぶPDFがあり、括弧付きの付随情報まで拾うことがある）
    makerName: collapseSpaces(pick(L.makerName)).replace(/[（(].*$/, "").trim(),
  };
}

/**
 * 車検証PDFを解析する。テキストが取れないPDF（スキャン画像）では null を返し、
 * 呼び出し側がAI読み取りへフォールバックする。
 */
export function parseShakenPdf(pdf: Buffer): ShakenPdfFields | null {
  const lines = pdfToLines(pdf);
  if (lines.length === 0) return null;
  const f = parseShakenPdfLines(lines);
  // 車検証と判断できる最低条件: 車台番号か登録番号のどちらかが取れている
  if (!f.vin && !f.registrationNumber) return null;
  return f;
}
