import AdmZip from "adm-zip";

// zip なら中身の bin を取り出す（最大サイズのエントリ＝本体とみなす）。
// zip でなければそのまま返す。encrypt に zip を渡す事故（焼けないslave生成）を防ぐ。
export function maybeUnzipBin(
  buf: Buffer,
  fileName?: string | null,
): { buf: Buffer; name: string | null; unzipped: boolean } {
  const isZip =
    buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
  if (!isZip) return { buf, name: fileName ?? null, unzipped: false };

  const zip = new AdmZip(buf);
  const entries = zip
    .getEntries()
    .filter((e) => !e.isDirectory && !e.entryName.startsWith("__MACOSX/"));
  if (entries.length === 0) {
    throw new Error("zipの中にファイルがありません");
  }
  // .bin 優先、無ければ最大サイズのエントリ
  const bins = entries.filter((e) => /\.bin$/i.test(e.entryName));
  const pool = bins.length > 0 ? bins : entries;
  const best = pool.reduce((a, b) => (b.header.size > a.header.size ? b : a));
  const data = best.getData();
  if (!data || data.length === 0) throw new Error("zipの解凍に失敗しました");
  return { buf: data, name: best.entryName.split("/").pop() ?? best.entryName, unzipped: true };
}
