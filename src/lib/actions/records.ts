"use server";

import { createHash } from "node:crypto";
import { after } from "next/server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { requireDealer, getSessionUser, assertOwnsDealer, requireHQ } from "@/lib/authz";
import { serviceRecordSchema, recordSupplementSchema } from "@/lib/validation/record";
import { type FormState, zodToFieldErrors } from "@/lib/actions/form-state";
import { saveUpload, storage } from "@/server/storage";
import { runDecryptJob } from "@/server/autotuner/job";
import { runMasterFileJob } from "@/server/autotuner/master-job";
import { learnEcuRules, smartExtractEcuId } from "@/server/ecu/learn";
import { aiExtractIds, aiEnabled, recordCorrection } from "@/server/ecu/ai-extract";
import { normalizeManufacturer } from "@/lib/catalog/manufacturers";

// 施工記録の登録（代理店が自店分を登録）
export async function createServiceRecord(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireDealer();

  const parsed = serviceRecordSchema.safeParse({
    vin: formData.get("vin"),
    carMaker: formData.get("carMaker"),
    carModel: formData.get("carModel"),
    carYear: formData.get("carYear"),
    ecuType: formData.get("ecuType"),
    tcuType: formData.get("tcuType"),
    softwareNumber: formData.get("softwareNumber"),
    workType: formData.get("workType"),
    appliedMap: formData.get("appliedMap"),
    customerName: formData.get("customerName"),
    registrationNumber: formData.get("registrationNumber"),
    vehicleModelCode: formData.get("vehicleModelCode"),
    engineModelCode: formData.get("engineModelCode"),
    modelDesignationNumber: formData.get("modelDesignationNumber"),
    firstRegistration: formData.get("firstRegistration"),
    inspectionExpiry: formData.get("inspectionExpiry"),
    shakenScanRaw: formData.get("shakenScanRaw"),
    workedAt: formData.get("workedAt"),
    note: formData.get("note"),
  });
  if (!parsed.success) {
    return {
      error: "入力内容を確認してください",
      fieldErrors: zodToFieldErrors(parsed.error),
    };
  }

  // 写真（複数可）を保存
  const photoPaths: string[] = [];
  const photos = formData.getAll("photos").filter((f): f is File => f instanceof File);
  for (const photo of photos) {
    if (photo.size === 0) continue;
    const res = await saveUpload(photo, "records");
    if (!res.ok) {
      return { error: res.error, fieldErrors: { photos: res.error } };
    }
    photoPaths.push(res.key);
  }

  const record = await prisma.serviceRecord.create({
    data: {
      dealerId: user.dealerId,
      vin: parsed.data.vin,
      carMaker: parsed.data.carMaker,
      carModel: parsed.data.carModel,
      carYear: parsed.data.carYear,
      ecuType: parsed.data.ecuType,
      tcuType: parsed.data.tcuType,
      softwareNumber: parsed.data.softwareNumber,
      workType: parsed.data.workType,
      appliedMap: parsed.data.appliedMap,
      customerName: parsed.data.customerName,
      registrationNumber: parsed.data.registrationNumber,
      vehicleModelCode: parsed.data.vehicleModelCode,
      engineModelCode: parsed.data.engineModelCode,
      modelDesignationNumber: parsed.data.modelDesignationNumber,
      firstRegistration: parsed.data.firstRegistration,
      inspectionExpiry: parsed.data.inspectionExpiry,
      shakenScanRaw: (parsed.data.shakenScanRaw as Prisma.InputJsonValue) ?? undefined,
      workedAt: parsed.data.workedAt,
      note: parsed.data.note,
      photoPaths,
      createdById: user.id,
    },
  });

  revalidatePath("/dealer/records");
  redirect(`/dealer/records/${record.id}`);
}

// ── スレーブアップロード＝施工記録の自動生成 ──────────────
// アップロード即時に ServiceRecord(UPLOADED) を作成して一覧に出現させ、
// 復号は after() でバックグラウンド実行する。
export async function uploadSlaveRecord(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireDealer();

  const file = formData.get("slaveFile");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "スレーブファイルを選択してください", fieldErrors: { slaveFile: "未選択" } };
  }
  // 顧客名（必須・代理店が入力）
  const customerName = String(formData.get("customerName") ?? "").trim();
  if (!customerName) {
    return { error: "顧客名を入力してください", fieldErrors: { customerName: "必須" } };
  }
  const saved = await saveUpload(file, "slaves");
  if (!saved.ok) {
    return { error: saved.error, fieldErrors: { slaveFile: saved.error } };
  }

  // 方針: 重複再利用(①)は廃止し、常に decrypt → 復号後の内容ハッシュでカタログ照合(②)で
  // 自動DL可否を判定する。記録ごとに復号binを持つため共有参照のバグが起きない。

  // UPLOADED で即作成 → その場で復号完了まで待つ（依頼内容をすぐ選べるように）
  const record = await prisma.serviceRecord.create({
    data: {
      dealerId: user.dealerId,
      createdById: user.id,
      source: "SLAVE_UPLOAD",
      status: "UPLOADED",
      slaveFilePath: saved.key,
      slaveHash: saved.sha256,
      customerName,
      isTuned: formData.get("isTuned") === "true", // チューニング済み＝ori扱いしない
      unit: formData.get("unit") === "TCU" ? "TCU" : "ECU", // 対象ユニット（取り違え防止）
    },
  });

  // バックグラウンドではなく同期実行。完了後の状態(DECODED/FAILED)を返す。
  await runDecryptJob(record.id);
  const done = await prisma.serviceRecord.findUnique({
    where: { id: record.id },
    select: { status: true },
  });
  revalidatePath("/dealer/records");

  return { ok: true, data: { recordId: record.id, status: done?.status ?? "DECODED" } };
}

// ── チューンド車用: 本店が純正(ori)binを事前アップ（代理店が ori .slave でDLできるように） ──
export async function uploadRecordOri(
  recordId: string,
  formData: FormData,
): Promise<{ ok?: true; fileName?: string; error?: string }> {
  await requireHQ();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "純正(ori)のbinを選択してください" };
  }
  const record = await prisma.serviceRecord.findUnique({
    where: { id: recordId },
    select: { id: true },
  });
  if (!record) return { error: "記録が見つかりません" };

  const buf = Buffer.from(await file.arrayBuffer());
  const hash = createHash("sha256").update(buf).digest("hex");
  const key = `records/hq-ori/${recordId}.bin`;
  await storage.save(key, buf, "application/octet-stream");
  await prisma.serviceRecord.update({
    where: { id: recordId },
    data: { oriFilePath: key, oriFileName: file.name, oriFileHash: hash },
  });
  revalidatePath(`/hq/records/${recordId}`);
  revalidatePath(`/dealer/records/${recordId}`);
  return { ok: true, fileName: file.name };
}

// 登録済みoriの取り外し（誤アップ時）
export async function removeRecordOri(
  recordId: string,
): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  await prisma.serviceRecord.update({
    where: { id: recordId },
    data: { oriFilePath: null, oriFileName: null, oriFileHash: null },
  });
  revalidatePath(`/hq/records/${recordId}`);
  revalidatePath(`/dealer/records/${recordId}`);
  return { ok: true };
}

// ── 本店専用の顧客関連ファイル（代理店非公開・備考付き） ──
export async function uploadRecordHqFile(
  recordId: string,
  formData: FormData,
): Promise<{ ok?: true; error?: string }> {
  const user = await requireHQ();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "ファイルを選択してください" };
  }
  const rec = await prisma.serviceRecord.findUnique({
    where: { id: recordId },
    select: { id: true },
  });
  if (!rec) return { error: "記録が見つかりません" };

  const saved = await saveUpload(file, `records/hq-files/${recordId}`);
  if (!saved.ok) return { error: saved.error };
  await prisma.recordHqFile.create({
    data: {
      serviceRecordId: recordId,
      filePath: saved.key,
      fileName: saved.filename,
      fileSize: saved.size,
      contentType: saved.contentType,
      note: String(formData.get("note") ?? "").trim() || null,
      uploadedById: user.id,
    },
  });
  revalidatePath(`/hq/records/${recordId}`);
  return { ok: true };
}

export async function updateRecordHqFileNote(
  fileId: string,
  note: string,
): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  const f = await prisma.recordHqFile.update({
    where: { id: fileId },
    data: { note: note.trim() || null },
    select: { serviceRecordId: true },
  });
  revalidatePath(`/hq/records/${f.serviceRecordId}`);
  return { ok: true };
}

export async function deleteRecordHqFile(
  fileId: string,
): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  const f = await prisma.recordHqFile.delete({
    where: { id: fileId },
    select: { serviceRecordId: true },
  });
  revalidatePath(`/hq/records/${f.serviceRecordId}`);
  return { ok: true };
}

// ── Master File（Powergate3・生bin）アップロード：MASTER形式の代理店(OBLY等)用 ──
// スレーブ復号APIは使わず、生binをそのままSHA-256照合してカタログに紐づける。
export async function uploadMasterFileRecord(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireDealer();
  const dealer = await prisma.dealer.findUnique({
    where: { id: user.dealerId },
    select: { fileFormat: true },
  });
  if (dealer?.fileFormat !== "MASTER") {
    return { error: "この操作はMasterFile形式の代理店のみ利用できます" };
  }

  const file = formData.get("masterFile");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "マスターファイルを選択してください", fieldErrors: { masterFile: "未選択" } };
  }
  const customerName = String(formData.get("customerName") ?? "").trim();
  if (!customerName) {
    return { error: "顧客名を入力してください", fieldErrors: { customerName: "必須" } };
  }
  const saved = await saveUpload(file, "masters");
  if (!saved.ok) {
    return { error: saved.error, fieldErrors: { masterFile: saved.error } };
  }

  const record = await prisma.serviceRecord.create({
    data: {
      dealerId: user.dealerId,
      createdById: user.id,
      source: "SLAVE_UPLOAD",
      status: "UPLOADED",
      slaveFilePath: saved.key, // Master File 実体（生bin）
      slaveHash: saved.sha256,
      customerName,
      unit: formData.get("unit") === "TCU" ? "TCU" : "ECU",
    },
  });

  await runMasterFileJob(record.id);
  const done = await prisma.serviceRecord.findUnique({
    where: { id: record.id },
    select: { status: true },
  });
  revalidatePath("/dealer/records");

  return { ok: true, data: { recordId: record.id, status: done?.status ?? "DECODED" } };
}

// ── 本部代行アップロード：本店が代理店を指定してスレーブを登録（過去案件の取込等） ──
// 代理店アップと同じ復号・照合パイプラインに乗せる。記録は指定代理店のものとして作成。
export async function uploadSlaveRecordByHQ(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireHQ(); // 本店管理者のみ

  const dealerId = String(formData.get("dealerId") ?? "");
  const dealer = await prisma.dealer.findUnique({ where: { id: dealerId }, select: { id: true } });
  if (!dealer) {
    return { error: "対象の代理店を選択してください", fieldErrors: { dealerId: "未選択" } };
  }

  const file = formData.get("slaveFile");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "スレーブファイルを選択してください", fieldErrors: { slaveFile: "未選択" } };
  }
  const customerName = String(formData.get("customerName") ?? "").trim();
  if (!customerName) {
    return { error: "顧客名を入力してください", fieldErrors: { customerName: "必須" } };
  }
  // 施工日（任意）。未入力は当日。YYYY-MM-DD を JST 正午で保存し日付ズレを防ぐ。
  const workedAtRaw = String(formData.get("workedAt") ?? "").trim();
  let workedAt: Date | undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(workedAtRaw)) {
    const d = new Date(`${workedAtRaw}T12:00:00+09:00`);
    if (!Number.isNaN(d.getTime())) workedAt = d;
  }

  const saved = await saveUpload(file, "slaves");
  if (!saved.ok) {
    return { error: saved.error, fieldErrors: { slaveFile: saved.error } };
  }

  const record = await prisma.serviceRecord.create({
    data: {
      dealerId, // 指定代理店の記録として登録
      createdById: user.id, // 起票は本店
      source: "SLAVE_UPLOAD",
      status: "UPLOADED",
      slaveFilePath: saved.key,
      slaveHash: saved.sha256,
      customerName,
      isTuned: formData.get("isTuned") === "true", // チューニング済み＝ori扱いしない
      unit: formData.get("unit") === "TCU" ? "TCU" : "ECU", // 対象ユニット（取り違え防止）
      ...(workedAt ? { workedAt } : {}),
    },
  });

  await runDecryptJob(record.id);
  const done = await prisma.serviceRecord.findUnique({
    where: { id: record.id },
    select: { status: true, matchedBaseFileId: true },
  });

  // Driver 入力があれば、紐づいた純正(BaseFile)に反映（未設定の時のみ・本店のみ閲覧）
  const driver = String(formData.get("driver") ?? "").trim();
  if (driver && done?.matchedBaseFileId) {
    const base = await prisma.baseFile.findUnique({
      where: { id: done.matchedBaseFileId },
      select: { driver: true },
    });
    if (base && !base.driver) {
      await prisma.baseFile.update({
        where: { id: done.matchedBaseFileId },
        data: { driver, driverBorrowed: formData.get("driverBorrowed") === "true" },
      });
      revalidatePath("/hq/catalog");
    }
  }

  revalidatePath("/hq/records");
  revalidatePath("/dealer/records");

  return { ok: true, data: { recordId: record.id, status: done?.status ?? "DECODED" } };
}

// ── 代理店が後から補う項目を保存（VIN・施工種別・SW番号・写真など） ──
export async function updateRecordSupplement(
  recordId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireDealer();
  const record = await prisma.serviceRecord.findUnique({
    where: { id: recordId },
    select: { dealerId: true, photoPaths: true },
  });
  if (!record || record.dealerId !== user.dealerId) {
    return { error: "対象の施工記録が見つかりません" };
  }

  const parsed = recordSupplementSchema.safeParse({
    vin: formData.get("vin"),
    workType: formData.get("workType"),
    softwareNumber: formData.get("softwareNumber"),
    appliedMap: formData.get("appliedMap"),
    tcuType: formData.get("tcuType"),
    hwNumber: formData.get("hwNumber"),
    swNumber: formData.get("swNumber"),
    calNumber: formData.get("calNumber"),
    customerName: formData.get("customerName"),
    carYear: formData.get("carYear"),
    registrationNumber: formData.get("registrationNumber"),
    vehicleModelCode: formData.get("vehicleModelCode"),
    engineModelCode: formData.get("engineModelCode"),
    modelDesignationNumber: formData.get("modelDesignationNumber"),
    firstRegistration: formData.get("firstRegistration"),
    inspectionExpiry: formData.get("inspectionExpiry"),
    shakenScanRaw: formData.get("shakenScanRaw"),
    note: formData.get("note"),
  });
  if (!parsed.success) {
    return { error: "入力内容を確認してください", fieldErrors: zodToFieldErrors(parsed.error) };
  }

  // 追加写真（任意・既存に追記）
  const photoPaths = [...record.photoPaths];
  const photos = formData.getAll("photos").filter((f): f is File => f instanceof File);
  for (const photo of photos) {
    if (photo.size === 0) continue;
    const res = await saveUpload(photo, "records");
    if (!res.ok) return { error: res.error, fieldErrors: { photos: res.error } };
    photoPaths.push(res.key);
  }

  await prisma.serviceRecord.update({
    where: { id: recordId },
    data: {
      vin: parsed.data.vin,
      workType: parsed.data.workType ?? null,
      softwareNumber: parsed.data.softwareNumber,
      appliedMap: parsed.data.appliedMap,
      tcuType: parsed.data.tcuType,
      hwNumber: parsed.data.hwNumber,
      swNumber: parsed.data.swNumber,
      calNumber: parsed.data.calNumber,
      customerName: parsed.data.customerName,
      carYear: parsed.data.carYear,
      registrationNumber: parsed.data.registrationNumber,
      vehicleModelCode: parsed.data.vehicleModelCode,
      engineModelCode: parsed.data.engineModelCode,
      modelDesignationNumber: parsed.data.modelDesignationNumber,
      firstRegistration: parsed.data.firstRegistration,
      inspectionExpiry: parsed.data.inspectionExpiry,
      shakenScanRaw: (parsed.data.shakenScanRaw as Prisma.InputJsonValue) ?? undefined,
      note: parsed.data.note,
      photoPaths,
    },
  });

  revalidatePath(`/dealer/records/${recordId}`);
  revalidatePath("/dealer/records");
  return { ok: true };
}

// ── 本店専用メモの保存（代理店には一切見せない・本店のみ書込可） ──
export async function updateHqNote(
  recordId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireHQ(); // 本店管理者のみ
  const hqNote = String(formData.get("hqNote") ?? "").trim();
  await prisma.serviceRecord.update({
    where: { id: recordId },
    data: { hqNote: hqNote || null },
  });
  revalidatePath(`/hq/records/${recordId}`);
  return { ok: true };
}

// ── 本店: 施工記録の削除 ──────────
// 参照(依頼・DLログ・APIログ)は監査として残すため null 解除してから本体削除。
// 保管ファイル(slave/復号bin)も削除する。
// 施工記録の削除＝ソフト削除（アーカイブ）。ファイル・参照は保持し、一覧から隠すだけ。
// うっかり消しても /hq/admin の「アーカイブ」から復元できる。完全削除は purgeRecord。
export async function deleteRecord(recordId: string): Promise<{ ok?: true; error?: string }> {
  await requireHQ(); // 本店管理者のみ
  const record = await prisma.serviceRecord.findUnique({
    where: { id: recordId },
    select: { id: true },
  });
  if (!record) return { error: "施工記録が見つかりません" };

  await prisma.serviceRecord.update({
    where: { id: recordId },
    data: { deletedAt: new Date() },
  });

  revalidatePath("/hq/records");
  revalidatePath("/hq/admin");
  return { ok: true };
}

// アーカイブから復元。
export async function restoreRecord(recordId: string): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  await prisma.serviceRecord.update({
    where: { id: recordId },
    data: { deletedAt: null },
  });
  revalidatePath("/hq/records");
  revalidatePath("/hq/admin");
  return { ok: true };
}

// 完全削除（アーカイブ済みのみ）。参照を外し、行とファイルを物理削除。元に戻せない。
export async function purgeRecord(recordId: string): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  const record = await prisma.serviceRecord.findUnique({
    where: { id: recordId },
    select: {
      id: true,
      deletedAt: true,
      slaveFilePath: true,
      decryptedFilePath: true,
      photoPaths: true,
    },
  });
  if (!record) return { error: "施工記録が見つかりません" };
  if (!record.deletedAt) {
    return { error: "先にアーカイブ（削除）してから完全削除してください" };
  }

  // 参照を外す（監査ログは残す）
  await prisma.fileRequest.updateMany({
    where: { serviceRecordId: recordId },
    data: { serviceRecordId: null },
  });
  await prisma.catalogDownloadLog.updateMany({
    where: { serviceRecordId: recordId },
    data: { serviceRecordId: null },
  });
  await prisma.autotunerApiLog.updateMany({
    where: { recordId },
    data: { recordId: null },
  });

  await prisma.serviceRecord.delete({ where: { id: recordId } });

  // 保管ファイルを削除（失敗しても致命ではない）
  const keys = [record.slaveFilePath, record.decryptedFilePath, ...record.photoPaths].filter(
    (k): k is string => !!k,
  );
  for (const k of keys) {
    try {
      await storage.delete(k);
    } catch {
      /* 無視 */
    }
  }

  revalidatePath("/hq/records");
  revalidatePath("/hq/admin");
  return { ok: true };
}

// ── 本店: 顧客名の変更 ──────────
export async function setRecordCustomerName(
  recordId: string,
  name: string,
): Promise<{ ok?: true; error?: string }> {
  await requireHQ(); // 本店管理者のみ
  const v = name.trim();
  await prisma.serviceRecord.update({
    where: { id: recordId },
    data: { customerName: v || null },
  });
  revalidatePath(`/hq/records/${recordId}`);
  revalidatePath("/hq/records");
  return { ok: true };
}

// 施工日をその場で変更（本店のみ）。入力は YYYY-MM-DD。
export async function setRecordWorkedAt(
  recordId: string,
  dateStr: string,
): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  const v = (dateStr ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return { error: "日付の形式が不正です（YYYY-MM-DD）" };
  // TZ によって日付がずれないよう正午(UTC)で保存
  const d = new Date(`${v}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return { error: "日付が不正です" };
  await prisma.serviceRecord.update({
    where: { id: recordId },
    data: { workedAt: d },
  });
  revalidatePath(`/hq/records/${recordId}`);
  revalidatePath("/hq/records");
  return { ok: true };
}

// AIでCalを再判定（本店のみ）。既存案件の保存済み復号binを再復号せずにAIで読み直す。
// 過去案件（AI導入前に復号済み）を遡ってCal識別するために使う。
export async function reidentifyEcuAi(
  recordId: string,
): Promise<{ ok?: true; error?: string; cal?: string | null; confidence?: number | null }> {
  await requireHQ();
  if (!aiEnabled()) {
    return { error: "AIキー(ANTHROPIC_API_KEY)が未設定です。サーバに設定してください。" };
  }
  const rec = await prisma.serviceRecord.findUnique({
    where: { id: recordId },
    select: {
      decryptedFilePath: true,
      decryptedHash: true,
      carMaker: true,
      carModel: true,
      ecuType: true,
      method: true,
      engineModelCode: true,
    },
  });
  if (!rec?.decryptedFilePath) {
    return { error: "復号ファイルがありません（再判定できません）。" };
  }
  const file = await storage.read(rec.decryptedFilePath);
  if (!file) return { error: "復号ファイルが見つかりません。" };

  // パターン（メーカー考慮・ベンツは無効）をヒントに、AIで識別
  const pattern = await smartExtractEcuId(file.buffer, {
    hash: rec.decryptedHash,
    ecuType: rec.ecuType,
    manufacturer: rec.carMaker,
  });
  let ai;
  try {
    ai = await aiExtractIds(file.buffer, {
      hash: rec.decryptedHash,
      manufacturer: rec.carMaker,
      ecuType: rec.ecuType,
      method: rec.method,
      swHint: pattern.sw,
      calHint: pattern.cal,
      engineCode: rec.engineModelCode,
      engineDesc: rec.engineModelCode ?? rec.carModel,
      throwOnError: true,
      force: true, // 手動再判定はキャッシュ無視で読み直し＋上書き
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "AI呼び出しに失敗しました" };
  }
  if (!ai || (!ai.cal && !ai.sw && !ai.hw)) {
    return { error: "AIで識別子を特定できませんでした。手入力してください。" };
  }
  await prisma.serviceRecord.update({
    where: { id: recordId },
    data: {
      calNumber: ai.cal ?? pattern.cal,
      swNumber: ai.sw ?? pattern.sw,
      hwNumber: ai.hw ?? pattern.hw,
      idSource: ai.cal ? "AI" : "PATTERN",
      idConfidence: ai.cal ? ai.confidence : null,
    },
  });
  revalidatePath(`/hq/records/${recordId}`);
  revalidatePath(`/dealer/records/${recordId}`);
  return { ok: true, cal: ai.cal, confidence: ai.cal ? ai.confidence : null };
}

// 対象ユニット(ECU/TCU)の切替（本店のみ）。取り違えに気づいたら後から直せる。
// 自動取込された純正(BaseFile)にも反映して、カタログ側の表示・ファイル名も揃える。
export async function setRecordUnit(
  recordId: string,
  unit: string,
): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  const u = unit === "TCU" ? "TCU" : "ECU";
  await prisma.serviceRecord.update({ where: { id: recordId }, data: { unit: u } });
  await prisma.baseFile
    .updateMany({
      where: { capturedFromRecordId: recordId, source: "AUTO_CAPTURE" },
      data: { unit: u },
    })
    .catch(() => {});
  revalidatePath(`/hq/records/${recordId}`);
  revalidatePath(`/dealer/records/${recordId}`);
  revalidatePath("/hq/catalog");
  revalidatePath("/hq/catalog/pending");
  return { ok: true };
}

// 純正/チューニング済みの切替（本店のみ）。チューニング済みにしたら、誤って自動取込した
// 純正(AUTO_CAPTURE)はカタログから外す（ori扱いを取り消す）。
export async function setRecordTuned(
  recordId: string,
  isTuned: boolean,
): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  await prisma.serviceRecord.update({ where: { id: recordId }, data: { isTuned } });
  if (isTuned) {
    await prisma.baseFile
      .updateMany({
        where: { capturedFromRecordId: recordId, source: "AUTO_CAPTURE", archived: false },
        data: { archived: true },
      })
      .catch(() => {});
  }
  revalidatePath(`/hq/records/${recordId}`);
  revalidatePath(`/dealer/records/${recordId}`);
  revalidatePath("/hq/catalog");
  revalidatePath("/hq/catalog/pending");
  return { ok: true };
}

// 施工ログ（手動）の追加（本店のみ）。過去客の遡り登録などに使う。
export async function addServiceLog(
  recordId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  await requireHQ();
  const content = String(formData.get("content") ?? "").trim();
  if (!content) return { error: "施工内容を入力してください", fieldErrors: { content: "必須" } };
  const note = String(formData.get("note") ?? "").trim() || null;
  const raw = String(formData.get("performedAt") ?? "").trim();
  let performedAt = new Date();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const d = new Date(`${raw}T12:00:00+09:00`);
    if (!Number.isNaN(d.getTime())) performedAt = d;
  }
  const rec = await prisma.serviceRecord.findUnique({
    where: { id: recordId },
    select: { id: true },
  });
  if (!rec) return { error: "対象の施工記録が見つかりません" };
  await prisma.serviceLog.create({
    data: { serviceRecordId: recordId, performedAt, content, note },
  });
  revalidatePath(`/hq/records/${recordId}`);
  revalidatePath(`/dealer/records/${recordId}`);
  return { ok: true };
}

// 施工ログの削除（本店のみ）。
export async function deleteServiceLog(logId: string): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  const log = await prisma.serviceLog.findUnique({
    where: { id: logId },
    select: { serviceRecordId: true },
  });
  if (!log) return { ok: true };
  await prisma.serviceLog.delete({ where: { id: logId } });
  revalidatePath(`/hq/records/${log.serviceRecordId}`);
  revalidatePath(`/dealer/records/${log.serviceRecordId}`);
  return { ok: true };
}

// ECU識別子(HW/SW/Cal)を手動で入力・修正（本店のみ）。
// 自動抽出に未対応の車種（ベンツ等）で本店が手動補完するために使う。
export async function setRecordEcu(
  recordId: string,
  fields: { hw?: string; sw?: string; cal?: string },
): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  const norm = (x?: string) => {
    const t = (x ?? "").trim();
    return t || null;
  };
  await prisma.serviceRecord.update({
    where: { id: recordId },
    data: {
      hwNumber: norm(fields.hw),
      swNumber: norm(fields.sw),
      calNumber: norm(fields.cal),
      idSource: "MANUAL", // 本店が確認・確定（AI自動認識タグは外す）
      idConfidence: null,
    },
  });

  // 手入力した HW/SW/Cal を、紐づくカタログ純正(BaseFile)にも反映。
  // 本店の手入力は確定値とみなし、空欄補完だけでなく自動抽出の誤値(例: ベンツの定数部番)も
  // 上書きする。これで未整備ストック/カタログの Cal が空欄/誤値のまま残らない。
  const rec = await prisma.serviceRecord.findUnique({
    where: { id: recordId },
    select: { matchedBaseFileId: true },
  });
  if (rec?.matchedBaseFileId) {
    const base = await prisma.baseFile.findUnique({
      where: { id: rec.matchedBaseFileId },
      select: { calNumber: true, swNumber: true, hwNumber: true },
    });
    if (base) {
      const fill: { calNumber?: string; swNumber?: string; hwNumber?: string } = {};
      const cal = norm(fields.cal);
      const sw = norm(fields.sw);
      const hw = norm(fields.hw);
      if (cal && cal !== base.calNumber) fill.calNumber = cal;
      if (sw && sw !== base.swNumber) fill.swNumber = sw;
      if (hw && hw !== base.hwNumber) fill.hwNumber = hw;
      if (Object.keys(fill).length > 0) {
        await prisma.baseFile.update({ where: { id: rec.matchedBaseFileId }, data: fill });
        revalidatePath("/hq/catalog");
        revalidatePath("/hq/catalog/pending");
      }
    }
  }

  // 手入力した HW/SW/Cal を学習（次回以降の自動認識用・外部API不要）
  after(async () => {
    const r = await prisma.serviceRecord.findUnique({
      where: { id: recordId },
      select: {
        ecuType: true,
        decryptedHash: true,
        decryptedFilePath: true,
        carMaker: true,
        hwNumber: true,
        swNumber: true,
        calNumber: true,
      },
    });
    if (!r) return;
    const file = r.decryptedFilePath ? await storage.read(r.decryptedFilePath) : null;
    await learnEcuRules({
      buf: file?.buffer ?? null,
      hash: r.decryptedHash,
      ecuType: r.ecuType,
      hw: r.hwNumber,
      sw: r.swNumber,
      cal: r.calNumber,
    });
    // 修正の自己学習: AIキャッシュの誤値を消し、メーカー別の正解例として記録。
    await recordCorrection({
      manufacturer: r.carMaker ? normalizeManufacturer(r.carMaker) : null,
      ecu: r.ecuType,
      hash: r.decryptedHash,
      cal: r.calNumber,
      sw: r.swNumber,
      hw: r.hwNumber,
    });
  });

  revalidatePath(`/hq/records/${recordId}`);
  revalidatePath("/hq/records");
  return { ok: true };
}

// ── 本店: 施工代理店の付け替え（プルダウン変更） ──────────
export async function setRecordDealer(
  recordId: string,
  dealerId: string,
): Promise<{ ok?: true; error?: string }> {
  await requireHQ(); // 本店管理者のみ
  const dealer = await prisma.dealer.findUnique({ where: { id: dealerId }, select: { id: true } });
  if (!dealer) return { error: "代理店が見つかりません" };
  await prisma.serviceRecord.update({ where: { id: recordId }, data: { dealerId } });
  revalidatePath(`/hq/records/${recordId}`);
  revalidatePath("/hq/records");
  return { ok: true };
}

// ── 復号の再実行（FAILED や詰まった行のリカバリ） ──────────
export async function retryDecrypt(recordId: string): Promise<void> {
  const user = await getSessionUser();
  if (!user) return;
  const record = await prisma.serviceRecord.findUnique({
    where: { id: recordId },
    select: { dealerId: true, slaveFilePath: true },
  });
  if (!record || !record.slaveFilePath) return;
  assertOwnsDealer(user, record.dealerId); // 代理店は自店のみ・本店は可

  await prisma.serviceRecord.update({
    where: { id: recordId },
    data: { status: "UPLOADED", decryptError: null },
  });
  revalidatePath("/dealer/records");
  revalidatePath("/hq/records");

  after(async () => {
    await runDecryptJob(recordId);
  });
}
