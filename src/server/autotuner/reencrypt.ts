import { storage } from "@/server/storage";
import { encryptSlave } from "./client";
import type { EncryptIds } from "./types";

/*
 * .slave 配信の共通ポリシー：**配信のたびに必ず作り直す**。
 *
 * 背景: AutoTuner の .slave には有効期限がある（ツールで焼くときに「有効期限切れ」で弾かれる）。
 * 以前は一度作った .slave を無期限キャッシュして再配信していたため、時間が経つと期限切れの
 * 古い .slave を代理店に渡してしまっていた。復号ではなく再暗号化(encryptSlave)の作り直しが要る。
 *
 * cacheKey はもう「再配信用キャッシュ」ではなく、**最後に配信した .slave を監査・障害調査の
 * ために残す置き場**（毎回上書き）。将来 AutoTuner の有効期限が判明したら、ここに
 * 「期限内ならキャッシュ、超えたら作り直し」を1か所で足せる。
 *
 * 注意: 再暗号化は必ず「その記録の復号時に保存した車固有ID(slaveId 等)」で行う。ここでは
 * それらの鮮度は判断できない（顧客が読み直した/読みが古い場合は、作り直しても期限切れになる）。
 */
export async function freshSlave(
  source: Buffer,
  ids: EncryptIds,
  cacheKey: string,
  opts: { recordId?: string; mode?: "maps" | "backup" } = {},
): Promise<Buffer> {
  const enc = await encryptSlave(source, ids, opts);
  await storage.save(cacheKey, enc.slaveData, "application/octet-stream");
  return enc.slaveData;
}
