/*
 * bak→slave 用のzip整形（src/server/catalog/zip.ts）の検証。DB・ネットワーク不要。
 *
 * ここで守りたいこと（AutoTuner側が「ちゃんと圧縮されたzip」しか受け取らないため）:
 *   - 素のbinは zip に包まれ、entryが deflate(8) になっている
 *   - 無圧縮zip（method=0）は**中身を取り出して**deflateで詰め直される（入れ子zipにしない）
 *   - 既に圧縮済みのzipでも中身は変わらない（往復でバイト一致）
 *   - CRC32・サイズがzip仕様どおりに入っている（ツール側の検証で弾かれない）
 *   - zipとして読めない/非対応のものは素のファイルとして包む（落とさない）
 */
import { deflateRawSync, inflateRawSync } from "node:zlib";
import {
  buildZip,
  readZipEntries,
  ensureCompressedZip,
  looksLikeZip,
  crc32,
} from "../src/server/catalog/zip";

let fail = 0;
let n = 0;
function ok(label: string, cond: boolean) {
  n++;
  if (!cond) fail++;
  console.log(`  ${cond ? "✓" : "✗"} ${label}`);
}

/** テスト用: 無圧縮(store)のzipを手で組む＝現場から上がってくる「拡張子だけzip」の再現 */
function buildStoredZip(name: string, data: Buffer): Buffer {
  const nameBuf = Buffer.from(name, "utf8");
  const crc = crc32(data);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(0, 8); // method=0 (store)
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt16LE(0, 10); // method=0
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  central.writeUInt32LE(0, 42);
  const cdOffset = local.length + nameBuf.length + data.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length + nameBuf.length, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, nameBuf, data, central, nameBuf, eocd]);
}

/** zip内の最初のentryの圧縮方式を読む（0=無圧縮 / 8=deflate） */
function firstMethod(zip: Buffer): number {
  return zip.readUInt16LE(8);
}

// 実物に近い中身（同じ並びが続く＝圧縮が効くbinを模す）
const bak = Buffer.concat([
  Buffer.from("MBFAST-BAK-TEST"),
  Buffer.alloc(200_000, 0xff),
  Buffer.from(Array.from({ length: 50_000 }, (_, i) => i % 251)),
]);

console.log("[1] 素のbin → 圧縮zipに包む");
{
  const r = ensureCompressedZip(bak, "ABC123.bin");
  ok("action=zipped", r.action === "zipped");
  ok("zipになっている", looksLikeZip(r.buffer));
  ok("entryはdeflate(8)", firstMethod(r.buffer) === 8);
  ok("元より小さい（実際に圧縮されている）", r.buffer.length < bak.length);
  const back = readZipEntries(r.buffer);
  ok("読み戻せる", !!back && back.length === 1);
  ok("中身がバイト一致", !!back && back[0].data.equals(bak));
  ok("名前を保つ", !!back && back[0].name === "ABC123.bin");
}

console.log("[2] 「拡張子だけzip」（無圧縮）→ 中身を取り出して詰め直す");
{
  const stored = buildStoredZip("ABC123.bin", bak);
  ok("入力は無圧縮(method=0)", firstMethod(stored) === 0);
  const r = ensureCompressedZip(stored, "ignored.bin");
  ok("action=recompressed", r.action === "recompressed");
  ok("出力はdeflate(8)", firstMethod(r.buffer) === 8);
  ok("入れ子zipにしない（中身は元のbin）", (() => {
    const back = readZipEntries(r.buffer);
    return !!back && back.length === 1 && back[0].data.equals(bak) && !looksLikeZip(back[0].data);
  })());
  ok("元の無圧縮zipより小さい", r.buffer.length < stored.length);
}

console.log("[3] 既に圧縮済みのzip → 中身は変わらない");
{
  const good = buildZip([{ name: "X.bin", data: bak }]);
  const r = ensureCompressedZip(good, "ignored.bin");
  ok("action=recompressed（常に同じ経路）", r.action === "recompressed");
  const back = readZipEntries(r.buffer);
  ok("中身がバイト一致", !!back && back[0].data.equals(bak));
  ok("名前を保つ", !!back && back[0].name === "X.bin");
}

console.log("[4] 複数entryのzip（左右ECU等）も全部保つ");
{
  const a = Buffer.alloc(1000, 1);
  const b = Buffer.alloc(2000, 2);
  const src = buildZip([{ name: "L.bin", data: a }, { name: "R.bin", data: b }]);
  const r = ensureCompressedZip(src, "ignored.bin");
  const back = readZipEntries(r.buffer);
  ok("2件とも残る", !!back && back.length === 2);
  ok("順番と中身が一致", !!back && back[0].name === "L.bin" && back[0].data.equals(a) && back[1].data.equals(b));
}

console.log("[5] zip仕様の値（CRC32・サイズ）が正しい");
{
  const r = ensureCompressedZip(bak, "ABC.bin");
  const z = r.buffer;
  const crcInZip = z.readUInt32LE(14);
  const compSize = z.readUInt32LE(18);
  const rawSize = z.readUInt32LE(22);
  ok("CRC32が中身と一致", crcInZip === crc32(bak));
  ok("展開後サイズが一致", rawSize === bak.length);
  const nameLen = z.readUInt16LE(26);
  const data = z.subarray(30 + nameLen, 30 + nameLen + compSize);
  ok("圧縮データを単体で展開できる", inflateRawSync(data).equals(bak));
  // 参考: 標準のdeflateと同等に縮んでいるか（極端に非効率でないこと）
  ok("圧縮率が妥当", compSize <= deflateRawSync(bak, { level: 9 }).length + 64);
}

console.log("[6] 壊れた/非対応のものは素のファイルとして包む（落とさない）");
{
  // PKシグネチャだけあって中身が無い＝zipとして読めない
  const brokenZip = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(50, 7)]);
  const r = ensureCompressedZip(brokenZip, "broken.zip");
  ok("action=zipped（素として包む）", r.action === "zipped");
  ok("拡張子.zipのままにしない（.binへ直す）", r.names[0] === "broken.bin");
  const back = readZipEntries(r.buffer);
  ok("中身は入力そのもの", !!back && back[0].data.equals(brokenZip));
}

console.log("[7] 空ファイル・小さいファイルでも壊れない");
{
  for (const [label, buf] of [["空", Buffer.alloc(0)], ["1バイト", Buffer.from([0x41])]] as const) {
    const r = ensureCompressedZip(buf, "tiny.bin");
    const back = readZipEntries(r.buffer);
    ok(`${label}: 往復一致`, !!back && back.length === 1 && back[0].data.equals(buf));
  }
}

console.log("");
console.log(fail === 0 ? `✅ ${n}件すべて通過` : `❌ ${fail}/${n}件 失敗`);
process.exit(fail === 0 ? 0 : 1);
