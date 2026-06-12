/*
 * 復号後 ECU バイナリから識別子（HW / SW / Cal 等）を抽出する。
 * 第一対応は VAG(MED17) 系の ASCII 識別ブロック。判別不能なら各項目 null（graceful）。
 *
 * 例（RS3 8V / MED17.1.1）の識別ブロック:
 *   07K907309C  EV_ECM25TFS011 8V0907404  0004  MEDC17  2.5l R5/4V TFSI  CZGB ...
 *   → hw=07K907309C, sw=8V0907404, swVersion=0004, asw=EV_ECM25TFS011,
 *     ecuType=MEDC17, engineCode=CZGB, engineDesc="2.5l R5/4V TFSI", cal="8V0907404 0004"
 *
 * 注意: 識別子は暗号化スレーブには現れず、復号後データにのみ現れる。
 *       Cal の「正しい1値」はファイルにより一意でないため、既定は SW+バージョン。手修正前提。
 */

export type EcuId = {
  hw: string | null;
  sw: string | null;
  swVersion: string | null;
  asw: string | null;
  ecuType: string | null;
  engineCode: string | null;
  engineDesc: string | null;
  cal: string | null;
  rawBlock: string | null;
};

const EMPTY: EcuId = {
  hw: null,
  sw: null,
  swVersion: null,
  asw: null,
  ecuType: null,
  engineCode: null,
  engineDesc: null,
  cal: null,
  rawBlock: null,
};

// VAG 部品番号: 先頭数字 + 英数2 + 数字6 + 末尾英字0〜2（例 07K907309C, 8V0907404）
const VAG_PART = /\b\d[A-Z0-9]{2}\d{6}[A-Z]{0,2}\b/g;

// トヨタ/レクサス(Denso)ECM 部番: 89xxx-xxxxx（例 89663-24690）。これを SW=Cal とみなす。
const TOYOTA_PART = /\b89\d{3}-\d{5}\b/g;

// トヨタ/Denso 系 SW 抽出（VAG ブロックが無い場合のフォールバック）
function extractToyota(s: string): EcuId | null {
  const clean = s.replace(/[^\x20-\x7E]/g, " ");
  const parts = [...clean.matchAll(TOYOTA_PART)].map((m) => m[0]);
  const pn = mostFrequent(parts); // ヘッダに複数回現れるので最頻値を採用
  if (!pn) return null;
  return {
    ...EMPTY,
    sw: pn,
    cal: pn, // バージョン枝番が無いため Cal=部番
    rawBlock: pn,
  };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mostFrequent(words: string[]): string | null {
  if (words.length === 0) return null;
  const count = new Map<string, number>();
  for (const w of words) count.set(w, (count.get(w) ?? 0) + 1);
  let best: string | null = null;
  let bestN = 0;
  for (const [w, n] of count) {
    if (n > bestN) {
      best = w;
      bestN = n;
    }
  }
  return best;
}

export function extractEcuId(buf: Buffer): EcuId {
  try {
    const s = buf.toString("latin1");
    // VAG 識別ブロックは "EV_" を含む印字可能な連続領域。その周辺を窓として切り出す。
    const ev = s.indexOf("EV_");
    if (ev < 0) return extractToyota(s) ?? EMPTY;

    const win = s.slice(Math.max(0, ev - 60), ev + 320);
    // 制御文字を空白化（バイナリ境界のノイズ除去）
    const clean = win.replace(/[^\x20-\x7E]/g, " ");

    const parts = [...clean.matchAll(VAG_PART)].map((m) => m[0]);
    let hw: string | null = null;
    let sw: string | null = null;
    if (parts.length >= 2) {
      hw = parts[0];
      sw = parts[1];
    } else if (parts.length === 1) {
      sw = parts[0];
    }

    let swVersion: string | null = null;
    if (sw) {
      const m = clean.match(new RegExp(`${escapeRe(sw)}\\s+(\\d{4})\\b`));
      if (m) swVersion = m[1];
    }

    // ASW: EV_ で始まるトークン。末尾に SW 番号が連結している場合は剥がす。
    let asw: string | null = null;
    const aswM = clean.match(/EV_[A-Z0-9]+/);
    if (aswM) {
      asw = aswM[0];
      if (sw && asw.endsWith(sw)) asw = asw.slice(0, -sw.length) || null;
    }

    const ecuM = clean.match(/MED[C]?\s?17(?:[.\d]+)?/);
    const ecuType = ecuM ? ecuM[0].replace(/\s+/g, "") : null;

    const caps = [...clean.matchAll(/\b[A-Z]{4}\b/g)]
      .map((m) => m[0])
      .filter((w) => w !== "TFSI" && w !== "MEDC");
    const engineCode = mostFrequent(caps);

    const descM = clean.match(/\d\.\dl\s+[A-Z0-9/ ]*?TFSI/i);
    const engineDesc = descM ? descM[0].replace(/\s{2,}/g, " ").trim() : null;

    // VAG(MED17)系の Cal は「SW番号_バージョン」をアンダースコア結合し、1トークン化（分割されない）。
    const cal = sw && swVersion ? `${sw}_${swVersion}` : sw;

    // rawBlock は HW から始め、エンジンコードの最終出現までで切る（前後のバイナリ雑音を除去）
    let raw = clean;
    if (hw) {
      const i = clean.indexOf(hw);
      if (i >= 0) raw = clean.slice(i);
    }
    raw = raw.replace(/\s{2,}/g, " ").trim();
    if (engineCode) {
      const last = raw.lastIndexOf(engineCode);
      if (last >= 0) raw = raw.slice(0, last + engineCode.length);
    }
    const rawBlock = raw.slice(0, 200) || null;

    // VAG ブロックはあったが SW を取れなかった場合はトヨタ系も試す
    if (!sw) return extractToyota(s) ?? EMPTY;

    return { hw, sw, swVersion, asw, ecuType, engineCode, engineDesc, cal, rawBlock };
  } catch {
    return EMPTY;
  }
}
