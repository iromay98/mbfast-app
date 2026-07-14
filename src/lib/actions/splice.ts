"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireHQ } from "@/lib/authz";
import { storage } from "@/server/storage";
import { computeSplice } from "@/server/util/splice";

export type SpliceReport = {
  ok: boolean;
  error?: string;
  candidateKey?: string; // 保存した候補binのキー（DL用）
  changedBytes?: number;
  rangeCount?: number;
  sameLayout?: boolean;
  note?: string;
  outSize?: number;
};

// 別ツール準用のニコイチ候補を生成（本店専用）。
// 代理店の ori（この車の実読み）に、source variant のキャリブレーション差分だけを転写する。
// 生成物は「候補」。自動配布・自動slave化は一切しない。本店が中身を確認してから使う。
export async function generateSpliceCandidate(
  recordId: string,
  sourceVariantId: string,
): Promise<SpliceReport> {
  await requireHQ();

  const record = await prisma.serviceRecord.findUnique({
    where: { id: recordId },
    select: { isTuned: true, decryptedFilePath: true, oriFilePath: true },
  });
  if (!record) return { ok: false, error: "施工記録が見つかりません" };

  // 代理店の ori: 純正読みは復号ファイル / チューニング済み読みは本店登録の純正
  const dealerOriPath = record.isTuned ? record.oriFilePath : record.decryptedFilePath;
  if (!dealerOriPath) {
    return {
      ok: false,
      error: record.isTuned
        ? "この記録はチューニング済み読みです。先に本店が純正(ori)binを登録してください"
        : "この記録に復号済みの純正(ori)がありません",
    };
  }

  const variant = await prisma.tunedVariant.findUnique({
    where: { id: sourceVariantId },
    select: {
      fileRef: true,
      baseFile: { select: { stockFileRef: true, manufacturer: true, model: true } },
    },
  });
  if (!variant?.fileRef) return { ok: false, error: "元バリエーションにチューン済みファイルがありません" };
  if (!variant.baseFile?.stockFileRef) {
    return { ok: false, error: "元バリエーションの純正(ori)binがカタログにありません（差分を取れません）" };
  }

  const [dealerOri, oriCat, tunedCat] = await Promise.all([
    storage.read(dealerOriPath),
    storage.read(variant.baseFile.stockFileRef),
    storage.read(variant.fileRef),
  ]);
  if (!dealerOri || !oriCat || !tunedCat) {
    return { ok: false, error: "必要なファイル（代理店ori / catalog ori / tuned）を読み込めませんでした" };
  }

  const res = computeSplice(oriCat.buffer, tunedCat.buffer, dealerOri.buffer);
  if (!res.ok) return { ok: false, error: res.error };

  const hash = createHash("sha256").update(res.output).digest("hex").slice(0, 12);
  const candidateKey = `records/splice/${recordId}__${sourceVariantId}__${hash}.bin`;
  await storage.save(candidateKey, res.output, "application/octet-stream");

  revalidatePath(`/hq/records/${recordId}`);
  return {
    ok: true,
    candidateKey,
    changedBytes: res.changedBytes,
    rangeCount: res.ranges.length,
    sameLayout: res.sameLayout,
    note: res.note,
    outSize: res.output.byteLength,
  };
}
