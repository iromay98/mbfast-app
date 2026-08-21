/*
 * 最小のZIP読み書き（依存ライブラリなし・node:zlib のみ）。
 *
 * なぜ必要か: AutoTuner の .slave（bak＝ECU全内容）は **中身がちゃんと圧縮されたzip**
 * でないと受け取ってもらえない。一方 Powergate3 の Master File は「拡張子が .zip なだけで
 * 無圧縮」でも書き込めるため、現場では無圧縮zipや素の .bin がそのまま上がってくる。
 * そのまま渡すと slave 側で弾かれるので、暗号化の直前にここで整える。
 *
 * 方針:
 * - 入力がzipなら**中身を取り出して deflate で詰め直す**（zipの入れ子は作らない。
 *   二重zipにすると AutoTuner が1回展開した先が .zip になって結局読めない）
 * - 入力がzipでなければ、そのファイル1つを deflate で包んだzipにする
 * - 出力は常に「entryが deflate 圧縮された単層zip」＝slaveへ渡せる形
 *
 * 対応範囲: 格納(0)/deflate(8) のみ。zip64・暗号化zip・その他の圧縮方式は非対応
 * （判別できたら null を返し、呼び出し側で「素のファイルとして包む」に倒す）。
 */
import { deflateRawSync, inflateRawSync } from "node:zlib";

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;
const METHOD_STORE = 0;
const METHOD_DEFLATE = 8;
/** zip64 が必要な閾値。ECUのbakは数MB〜なので通常到達しない */
const U32_MAX = 0xffffffff;

export type ZipEntry = { name: string; data: Buffer };


// ── CRC32（zlib.crc32 はNodeのバージョン差があるため自前で持つ） ──
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

export function crc32(buf: Buffer): number {
  let c = 0 ^ -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
  return (c ^ -1) >>> 0;
}

/** zipの見た目をしているか（先頭シグネチャだけの軽い判定） */
export function looksLikeZip(buf: Buffer): boolean {
  return buf.length >= 4 && buf.readUInt32LE(0) === SIG_LOCAL;
}

/**
 * zipのentryを読み出す。zipでない・非対応形式なら null。
 * サイズは中央ディレクトリの値を使う（ローカルヘッダは0のことがある＝ストリーミング作成）。
 */
export function readZipEntries(buf: Buffer): ZipEntry[] | null {
  if (buf.length < 22) return null;
  // EOCD を末尾から探す（コメント最大64KB）
  const from = Math.max(0, buf.length - (22 + 0xffff));
  let eocd = -1;
  for (let i = buf.length - 22; i >= from; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;

  const count = buf.readUInt16LE(eocd + 10);
  const cdSize = buf.readUInt32LE(eocd + 12);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (cdOffset === U32_MAX || cdSize === U32_MAX) return null; // zip64は非対応
  if (cdOffset + cdSize > buf.length) return null;

  const out: ZipEntry[] = [];
  let p = cdOffset;
  for (let i = 0; i < count; i++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== SIG_CENTRAL) return null;
    const flags = buf.readUInt16LE(p + 8);
    const method = buf.readUInt16LE(p + 10);
    const compSize = buf.readUInt32LE(p + 20);
    const rawSize = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nameLen).toString("utf8");
    p += 46 + nameLen + extraLen + commentLen;

    if (flags & 0x1) return null; // 暗号化zipは非対応
    if (compSize === U32_MAX || rawSize === U32_MAX) return null; // zip64
    if (name.endsWith("/")) continue; // ディレクトリentryは飛ばす

    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== SIG_LOCAL) return null;
    const lNameLen = buf.readUInt16LE(localOffset + 26);
    const lExtraLen = buf.readUInt16LE(localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    if (dataStart + compSize > buf.length) return null;
    const raw = buf.subarray(dataStart, dataStart + compSize);

    let data: Buffer;
    if (method === METHOD_STORE) data = Buffer.from(raw);
    else if (method === METHOD_DEFLATE) {
      try {
        data = inflateRawSync(raw);
      } catch {
        return null; // 壊れている・実は別形式
      }
    } else return null; // bzip2 等は非対応

    if (rawSize !== 0 && data.length !== rawSize) return null; // 記載サイズと不一致＝信用しない
    out.push({ name, data });
  }
  return out;
}

/** entryを deflate 圧縮した単層zipを作る（DOS日時は固定＝同じ入力なら同じ出力） */
export function buildZip(entries: ZipEntry[]): Buffer<ArrayBuffer> {
  // 1980-01-01 00:00:00（DOS日時の最小値）で固定する
  const dosTime = 0;
  const dosDate = (1 << 5) | 1; // 年=1980, 月=1, 日=1
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = Buffer.from(e.name, "utf8");
    const comp = deflateRawSync(e.data, { level: 9 });
    const crc = crc32(e.data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(SIG_LOCAL, 0);
    local.writeUInt16LE(20, 4); // 展開に必要なバージョン(2.0)
    local.writeUInt16LE(0x0800, 6); // ファイル名をUTF-8として扱うフラグ
    local.writeUInt16LE(METHOD_DEFLATE, 8);
    local.writeUInt16LE(dosTime, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(comp.length, 18);
    local.writeUInt32LE(e.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    locals.push(local, name, comp);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(SIG_CENTRAL, 0);
    central.writeUInt16LE(20, 4); // 作成バージョン
    central.writeUInt16LE(20, 6); // 展開に必要なバージョン
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(METHOD_DEFLATE, 10);
    central.writeUInt16LE(dosTime, 12);
    central.writeUInt16LE(dosDate, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(comp.length, 20);
    central.writeUInt32LE(e.data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30); // extra
    central.writeUInt16LE(0, 32); // comment
    central.writeUInt16LE(0, 34); // ディスク番号
    central.writeUInt16LE(0, 36); // 内部属性
    central.writeUInt32LE(0, 38); // 外部属性
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);

    offset += local.length + name.length + comp.length;
  }

  const cd = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(SIG_EOCD, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);
  return Buffer.concat([...locals, cd, eocd]) as Buffer<ArrayBuffer>;
}

export type EnsureZipResult = {
  /** slaveへ渡せる形（deflate圧縮された単層zip） */
  buffer: Buffer<ArrayBuffer>;
  /** 何をしたか（画面のメッセージ・監査用） */
  action: "zipped" | "recompressed" | "kept";
  /** zip内のファイル名一覧 */
  names: string[];
};

/**
 * 「ちゃんと圧縮されたzip」に整える。
 * - 素のファイル（.bin 等）→ そのファイル1つを包んだzipにする（zipped）
 * - zip（無圧縮/圧縮どちらでも）→ 中身を取り出して deflate で詰め直す（recompressed）
 *   ※既にdeflateだけのzipでも詰め直す。ここを条件分岐にすると
 *     「無圧縮entryが1つ混じったzip」を見落とすため、常に同じ経路にする
 * - 読めないzip（非対応形式・破損）→ 素のファイルとして包む（zipped）
 *
 * fallbackName は素のファイルとして包むときのzip内の名前。
 * 拡張子が .zip のまま中身がzipでない紛らわしいケースは .bin に直す。
 */
export function ensureCompressedZip(buf: Buffer, fallbackName: string): EnsureZipResult {
  const entries = looksLikeZip(buf) ? readZipEntries(buf) : null;
  if (entries && entries.length > 0) {
    return { buffer: buildZip(entries), action: "recompressed", names: entries.map((e) => e.name) };
  }
  const name = /\.zip$/i.test(fallbackName)
    ? fallbackName.replace(/\.zip$/i, ".bin")
    : fallbackName || "backup.bin";
  return { buffer: buildZip([{ name, data: buf }]), action: "zipped", names: [name] };
}
