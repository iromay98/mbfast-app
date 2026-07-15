import AdmZip from "adm-zip";

// アップロードされたファイルを encrypt に渡す形へ整える。
//
// 重要な区別:
//  - mode="backup"（bak）: AutoTunerのバックアップは contents.ini + iflash0/iflash1/dflash0 …
//    をまとめた「一式（EcuXコンテナ）」that自体が正しい入力。**絶対に展開しない**。
//    展開して単一binを送ると中身が欠けた別物になる（危険）。
//  - mode="maps": 単一の生binが入力。zipで来たら中の bin を1つだけ取り出す。
//    複数binが入っている場合は勝手に選ばず、エラーにして人に選ばせる。

export type UnzipMode = "maps" | "backup";

function isZip(buf: Buffer): boolean {
  return buf.length > 4 && buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04;
}

function entries(buf: Buffer) {
  const zip = new AdmZip(buf);
  return zip
    .getEntries()
    .filter((e) => !e.isDirectory && !e.entryName.startsWith("__MACOSX/"));
}

// AutoTunerのバックアップ一式か（contents.ini を含む / iflashN.bin が複数ある 等）
export function looksLikeAutotunerBackup(buf: Buffer): boolean {
  if (!isZip(buf)) return false;
  try {
    const names = entries(buf).map((e) => e.entryName.split("/").pop()?.toLowerCase() ?? "");
    const hasIni = names.includes("contents.ini");
    const flashCount = names.filter((n) => /^(i|d)flash\d*\.bin$/.test(n)).length;
    return hasIni || flashCount > 1;
  } catch {
    return false;
  }
}

export function maybeUnzipBin(
  buf: Buffer,
  fileName?: string | null,
  mode: UnzipMode = "maps",
): { buf: Buffer; name: string | null; unzipped: boolean } {
  // bak: バックアップ一式はそのまま渡す（展開厳禁）
  if (mode === "backup") {
    return { buf, name: fileName ?? null, unzipped: false };
  }

  if (!isZip(buf)) return { buf, name: fileName ?? null, unzipped: false };

  // maps に AutoTunerバックアップ一式が来たら取り違え。展開せずに案内する。
  if (looksLikeAutotunerBackup(buf)) {
    throw new Error(
      "これはAutoTunerのバックアップ一式（contents.ini・iflash/dflash）です。マップのみ変換には使えません。「💾 bak（bakに変換）」から送ってください",
    );
  }

  const list = entries(buf);
  if (list.length === 0) throw new Error("zipの中にファイルがありません");

  const bins = list.filter((e) => /\.bin$/i.test(e.entryName));
  const pool = bins.length > 0 ? bins : list;
  if (pool.length > 1) {
    const names = pool.map((e) => e.entryName.split("/").pop()).join(" / ");
    throw new Error(
      `zip内にファイルが複数あります（${names}）。どれを使うか判断できないため、対象のbinを1つだけzipに入れるか、bin単体でアップしてください`,
    );
  }
  const best = pool[0];
  const data = best.getData();
  if (!data || data.length === 0) throw new Error("zipの解凍に失敗しました");
  return { buf: data, name: best.entryName.split("/").pop() ?? best.entryName, unzipped: true };
}
