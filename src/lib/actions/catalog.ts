"use server";

import { after } from "next/server";
import { createHash } from "crypto";
import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireHQ } from "@/lib/authz";
import { saveUpload, storage } from "@/server/storage";
import { notify } from "@/server/notifications";
import { smartExtractEcuId, learnEcuRules } from "@/server/ecu/learn";
import {
  aiExtractIds,
  aiAnalyzeStock,
  aiEnabled,
  recordCandidateTokens,
  recordCorrection,
} from "@/server/ecu/ai-extract";
import { sendPushToUsers, recipientUserIds } from "@/server/push";
import {
  fuelKindOf,
  optionTagsFor,
  popsAllowed,
  tuningContentLabel,
  parseTuningContentLabel,
} from "@/lib/catalog/options";
import { type FormState, zodToFieldErrors } from "@/lib/actions/form-state";
import {
  baseFilePatchSchema,
  variantCreateSchema,
  variantPatchSchema,
  variantStatusEnum,
} from "@/lib/validation/catalog";
import { normalizeManufacturer } from "@/lib/catalog/manufacturers";

const CATALOG_PATH = "/hq/catalog";

function isUniqueError(e: unknown): boolean {
  return (
    typeof e === "object" &&
    e !== null &&
    (e as { code?: string }).code === "P2002"
  );
}

// 行追加: 既存 base 指定 or 新規 base を作成して TunedVariant を作る
export async function createVariant(input: {
  baseFileId?: string;
  manufacturer?: string;
  model?: string;
  ecu?: string;
  mcu?: string;
  stockHash?: string;
  stage?: string;
  popsAndBangs?: boolean;
  popsSport?: boolean;
  options?: string;
  note?: string;
}): Promise<FormState> {
  const user = await requireHQ();
  const parsed = variantCreateSchema.safeParse(input);
  if (!parsed.success) {
    return { error: "入力内容を確認してください", fieldErrors: zodToFieldErrors(parsed.error) };
  }
  const d = parsed.data;

  let baseFileId = d.baseFileId;
  if (!baseFileId) {
    if (!d.manufacturer || !d.model || !d.ecu) {
      return { error: "メーカー・車種・ECU は必須です" };
    }
    try {
      const base = await prisma.baseFile.create({
        data: {
          manufacturer: d.manufacturer,
          model: d.model,
          ecu: d.ecu,
          mcu: d.mcu,
          stockHash: d.stockHash,
          createdById: user.id,
        },
      });
      baseFileId = base.id;
    } catch (e) {
      if (isUniqueError(e)) return { error: "同じ stockHash の項目が既に存在します" };
      throw e;
    }
  }

  const variant = await prisma.tunedVariant.create({
    data: {
      baseFileId,
      stage: d.stage ?? "",
      popsAndBangs: d.popsAndBangs ?? false,
      popsSport: d.popsAndBangs ? (d.popsSport ?? false) : false,
      options: d.options,
      note: d.note,
      status: "DRAFT",
      createdById: user.id,
    },
  });
  revalidatePath(CATALOG_PATH);
  return { ok: true, data: { id: variant.id } };
}

// インライン編集（送られたキーのみ反映。空文字はクリア）。variant と base 両方を扱う。
export async function updateVariant(
  variantId: string,
  patch: Record<string, unknown>,
): Promise<FormState> {
  await requireHQ();
  const parsed = variantPatchSchema.safeParse(patch);
  if (!parsed.success) {
    return { error: "入力内容を確認してください", fieldErrors: zodToFieldErrors(parsed.error) };
  }
  const d = parsed.data;

  const variantData: Record<string, unknown> = {};
  if ("stage" in patch) variantData.stage = d.stage ?? "";
  if ("popsAndBangs" in patch) variantData.popsAndBangs = d.popsAndBangs ?? false;
  if ("optionTags" in patch) variantData.optionTags = d.optionTags ?? [];
  if ("options" in patch) variantData.options = d.options ? d.options : null;
  if ("note" in patch) variantData.note = d.note ? d.note : null;
  if ("status" in patch && d.status) variantData.status = d.status;

  const baseData: Record<string, unknown> = {};
  if ("manufacturer" in patch && d.manufacturer) baseData.manufacturer = d.manufacturer;
  if ("model" in patch && d.model) baseData.model = d.model;
  if ("ecu" in patch && d.ecu) baseData.ecu = d.ecu;
  if ("mcu" in patch) baseData.mcu = d.mcu ? d.mcu : null;

  if (Object.keys(variantData).length > 0) {
    await prisma.tunedVariant.update({ where: { id: variantId }, data: variantData });
  }
  if (Object.keys(baseData).length > 0) {
    const v = await prisma.tunedVariant.findUnique({
      where: { id: variantId },
      select: { baseFileId: true },
    });
    if (v) await prisma.baseFile.update({ where: { id: v.baseFileId }, data: baseData });
  }
  revalidatePath(CATALOG_PATH);
  return { ok: true };
}

// 既存の版を複製（同一ベース・stage/pops/optionTags/options・現行ファイルを引き継ぎ DRAFT で作成）
export async function duplicateVariant(variantId: string): Promise<FormState> {
  const user = await requireHQ();
  const src = await prisma.tunedVariant.findUnique({
    where: { id: variantId },
    select: {
      baseFileId: true,
      stage: true,
      popsAndBangs: true,
      optionTags: true,
      options: true,
      note: true,
      fileRef: true,
      fileHash: true,
      fileName: true,
      fileSize: true,
      contentType: true,
    },
  });
  if (!src) return { error: "複製元が見つかりません" };

  const copy = await prisma.tunedVariant.create({
    data: {
      baseFileId: src.baseFileId,
      stage: src.stage,
      popsAndBangs: src.popsAndBangs,
      optionTags: src.optionTags,
      options: src.options,
      note: src.note,
      status: "DRAFT", // 複製は下書きから
      createdById: user.id,
    },
  });

  // 現行ファイルがあれば v1 として引き継ぐ（同じ storage 参照を共有・読み取り専用）
  if (src.fileRef) {
    const ver = await prisma.tunedVariantVersion.create({
      data: {
        variantId: copy.id,
        version: 1,
        fileRef: src.fileRef,
        fileHash: src.fileHash ?? "",
        fileName: src.fileName,
        fileSize: src.fileSize,
        contentType: src.contentType,
        replacedById: user.id,
      },
    });
    await prisma.tunedVariant.update({
      where: { id: copy.id },
      data: {
        currentVersionId: ver.id,
        fileRef: src.fileRef,
        fileHash: src.fileHash,
        fileName: src.fileName,
        fileSize: src.fileSize,
        contentType: src.contentType,
      },
    });
  }

  revalidatePath(CATALOG_PATH);
  return { ok: true, data: { id: copy.id } };
}

// 版の削除（履歴は Cascade で削除、DLログは SetNull で監査として残す）
// 版の削除＝ソフト削除（アーカイブ）。版・履歴・ファイルは保持し、カタログ/照合から隠すだけ。
// /hq/admin の「アーカイブ」から復元可。完全削除は purgeVariant。
export async function deleteVariant(variantId: string): Promise<FormState> {
  await requireHQ();
  await prisma.tunedVariant.update({
    where: { id: variantId },
    data: { deletedAt: new Date() },
  });
  revalidatePath(CATALOG_PATH);
  revalidatePath(PENDING_PATH);
  revalidatePath("/hq/admin");
  return { ok: true };
}

// アーカイブから復元。
export async function restoreVariant(variantId: string): Promise<FormState> {
  await requireHQ();
  await prisma.tunedVariant.update({
    where: { id: variantId },
    data: { deletedAt: null },
  });
  revalidatePath(CATALOG_PATH);
  revalidatePath(PENDING_PATH);
  revalidatePath("/hq/admin");
  return { ok: true };
}

// 完全削除（アーカイブ済みのみ）。版(Cascade)・現行版ポインタごと物理削除。元に戻せない。
export async function purgeVariant(variantId: string): Promise<FormState> {
  await requireHQ();
  const v = await prisma.tunedVariant.findUnique({
    where: { id: variantId },
    select: { deletedAt: true },
  });
  if (!v) return { error: "対象が見つかりません" };
  if (!v.deletedAt) return { error: "先にアーカイブ（削除）してから完全削除してください" };
  // 現行版ポインタを外す（自己参照FK回避）
  await prisma.tunedVariant.update({ where: { id: variantId }, data: { currentVersionId: null } });
  // 本体削除 → versions は Cascade 削除、download log は variantId/versionId が SetNull
  await prisma.tunedVariant.delete({ where: { id: variantId } });
  revalidatePath(CATALOG_PATH);
  revalidatePath(PENDING_PATH);
  revalidatePath("/hq/admin");
  return { ok: true };
}

// 状態変更（AVAILABLE/DISABLED/DRAFT）。行の無効化＝DISABLED。
export async function setVariantStatus(
  variantId: string,
  status: string,
): Promise<FormState> {
  await requireHQ();
  const parsed = variantStatusEnum.safeParse(status);
  if (!parsed.success) return { error: "不正な状態です" };
  await prisma.tunedVariant.update({ where: { id: variantId }, data: { status: parsed.data } });
  revalidatePath(CATALOG_PATH);
  revalidatePath("/hq/catalog/pending");
  return { ok: true };
}

// 基本情報（BaseFile）の更新（stockHash の手動設定含む）
export async function updateBaseFile(
  baseFileId: string,
  patch: Record<string, unknown>,
): Promise<FormState> {
  await requireHQ();
  const parsed = baseFilePatchSchema.safeParse(patch);
  if (!parsed.success) {
    return { error: "入力内容を確認してください", fieldErrors: zodToFieldErrors(parsed.error) };
  }
  // Cal/SW/HW は空入力で「クリア(null)」できるようにする（誤認識値の消去用）。
  const data: Record<string, unknown> = { ...parsed.data };
  for (const k of ["calNumber", "swNumber", "hwNumber", "generation", "grade", "method"] as const) {
    if (k in patch) data[k] = String(patch[k] ?? "").trim() || null;
  }
  // 対象ユニットは "ECU"/"TCU" のみ（クリア不可・既定ECU）
  if ("unit" in patch) data.unit = patch.unit === "TCU" ? "TCU" : "ECU";
  // 読み取りツールは空なら既定 AT
  if ("tool" in patch) data.tool = String(patch.tool ?? "").trim() || "AT";
  try {
    await prisma.baseFile.update({ where: { id: baseFileId }, data });
  } catch (e) {
    if (isUniqueError(e)) return { error: "同じ stockHash の項目が既に存在します" };
    throw e;
  }

  // HW/SW/Cal を手入力したら学習（次回以降の自動認識用・外部API不要）
  if ("hwNumber" in patch || "swNumber" in patch || "calNumber" in patch) {
    after(async () => {
      const b = await prisma.baseFile.findUnique({
        where: { id: baseFileId },
        select: {
          ecu: true,
          stockHash: true,
          stockFileRef: true,
          manufacturer: true,
          hwNumber: true,
          swNumber: true,
          calNumber: true,
        },
      });
      if (!b) return;
      const file = b.stockFileRef ? await storage.read(b.stockFileRef) : null;
      await learnEcuRules({
        buf: file?.buffer ?? null,
        hash: b.stockHash,
        ecuType: b.ecu,
        hw: b.hwNumber,
        sw: b.swNumber,
        cal: b.calNumber,
        sourceBaseFileId: baseFileId,
      });
      // 修正の自己学習: AIキャッシュの誤値を消し、メーカー別の正解例として記録。
      await recordCorrection({
        manufacturer: b.manufacturer,
        ecu: b.ecu,
        hash: b.stockHash,
        cal: b.calNumber,
        sw: b.swNumber,
        hw: b.hwNumber,
      });
    });
  }

  revalidatePath(CATALOG_PATH);
  return { ok: true };
}

// チューニング済みファイルのアップロード/差し替え（バージョン管理）
export async function replaceVariantFile(
  variantId: string,
  formData: FormData,
): Promise<FormState> {
  const user = await requireHQ();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "ファイルを選択してください" };
  }
  const saved = await saveUpload(file, "catalog/tuned");
  if (!saved.ok) return { error: saved.error };

  const last = await prisma.tunedVariantVersion.findFirst({
    where: { variantId },
    orderBy: { version: "desc" },
    select: { version: true },
  });
  const version = (last?.version ?? 0) + 1;

  const ver = await prisma.tunedVariantVersion.create({
    data: {
      variantId,
      version,
      fileRef: saved.key,
      fileHash: saved.sha256,
      fileName: saved.filename,
      fileSize: saved.size,
      contentType: saved.contentType,
      replacedById: user.id,
    },
  });
  await prisma.tunedVariant.update({
    where: { id: variantId },
    data: {
      currentVersionId: ver.id,
      fileRef: saved.key,
      fileHash: saved.sha256,
      fileName: saved.filename,
      fileSize: saved.size,
      contentType: saved.contentType,
    },
  });
  revalidatePath(CATALOG_PATH);
  return { ok: true, data: { version } };
}

// 旧版に戻す（履歴は保持し、現行ポインタを差し替えるだけ）
// 版(バージョン)の ver名・特徴メモを更新（本店のみ）。
// バブリング等は版ごとに中身が違う（ver2・強め等）ため、ファイルに紐づけて記録する。
export async function updateVersionMeta(
  versionId: string,
  patch: { label?: string; note?: string },
): Promise<{ ok?: true; error?: string }> {
  await requireHQ();
  const data: Record<string, string | null> = {};
  if ("label" in patch) data.label = (patch.label ?? "").trim() || null;
  if ("note" in patch) data.note = (patch.note ?? "").trim() || null;
  await prisma.tunedVariantVersion.update({ where: { id: versionId }, data });
  revalidatePath(CATALOG_PATH);
  return { ok: true };
}

export async function restoreVariantVersion(
  variantId: string,
  versionId: string,
): Promise<FormState> {
  await requireHQ();
  const ver = await prisma.tunedVariantVersion.findUnique({ where: { id: versionId } });
  if (!ver || ver.variantId !== variantId) return { error: "対象の版が見つかりません" };
  await prisma.tunedVariant.update({
    where: { id: variantId },
    data: {
      currentVersionId: ver.id,
      fileRef: ver.fileRef,
      fileHash: ver.fileHash,
      fileName: ver.fileName,
      fileSize: ver.fileSize,
      contentType: ver.contentType,
    },
  });
  revalidatePath(CATALOG_PATH);
  return { ok: true };
}

const PENDING_PATH = "/hq/catalog/pending";

// 純正(BaseFile)の保存済み原本binをAIで読み直して Cal/SW/HW を更新（本店のみ）。
// 案件を介さずカタログから直接 Cal を再判定するためのもの。
export async function reidentifyBaseEcuAi(
  baseFileId: string,
): Promise<{ ok?: true; error?: string; cal?: string | null; confidence?: number | null }> {
  await requireHQ();
  if (!aiEnabled()) {
    return { error: "AIキー(ANTHROPIC_API_KEY)が未設定です。サーバに設定してください。" };
  }
  const base = await prisma.baseFile.findUnique({
    where: { id: baseFileId },
    select: {
      stockFileRef: true,
      stockHash: true,
      manufacturer: true,
      ecu: true,
      method: true,
      engineCode: true,
      model: true,
    },
  });
  if (!base?.stockFileRef) {
    return { error: "原本ファイルがありません（再判定できません）。" };
  }
  const file = await storage.read(base.stockFileRef);
  if (!file) return { error: "原本ファイルが見つかりません。" };

  const pattern = await smartExtractEcuId(file.buffer, {
    hash: base.stockHash,
    ecuType: base.ecu,
    manufacturer: base.manufacturer,
  });
  let ai;
  try {
    ai = await aiExtractIds(file.buffer, {
      hash: base.stockHash,
      manufacturer: base.manufacturer,
      ecuType: base.ecu,
      method: base.method,
      swHint: pattern.sw,
      calHint: pattern.cal,
      engineCode: base.engineCode,
      engineDesc: base.engineCode ?? base.model,
      throwOnError: true,
      force: true, // 手動再判定はキャッシュ無視で読み直し＋上書き
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "AI呼び出しに失敗しました" };
  }
  if (!ai || (!ai.cal && !ai.sw && !ai.hw)) {
    return { error: "AIで識別子を特定できませんでした。手入力してください。" };
  }
  await prisma.baseFile.update({
    where: { id: baseFileId },
    data: {
      calNumber: ai.cal ?? pattern.cal,
      swNumber: ai.sw ?? pattern.sw,
      hwNumber: ai.hw ?? pattern.hw,
    },
  });
  revalidatePath(CATALOG_PATH);
  revalidatePath(PENDING_PATH);
  return { ok: true, cal: ai.cal, confidence: ai.cal ? ai.confidence : null };
}

// Cal 未設定の純正をまとめてAI判定（本店のみ）。原本ありのみ。件数上限つき（コスト対策）。
export async function reidentifyMissingCalAi(
  limit = 20,
): Promise<{ ok?: true; error?: string; updated?: number; scanned?: number }> {
  await requireHQ();
  if (!aiEnabled()) {
    return { error: "AIキー(ANTHROPIC_API_KEY)が未設定です。サーバに設定してください。" };
  }
  const bases = await prisma.baseFile.findMany({
    where: { archived: false, calNumber: null, stockFileRef: { not: null } },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 50),
    select: { id: true, stockFileRef: true, stockHash: true },
  });
  // 事前パス: 全候補トークンを記録（API不要）。共通定数フィルタを先に効かせる。
  for (const b of bases) {
    if (!b.stockFileRef) continue;
    const f = await storage.read(b.stockFileRef);
    if (f) await recordCandidateTokens(f.buffer, b.stockHash);
  }
  let updated = 0;
  for (const b of bases) {
    const r = await reidentifyBaseEcuAi(b.id);
    if (r.ok && r.cal) updated++;
  }
  revalidatePath(CATALOG_PATH);
  revalidatePath(PENDING_PATH);
  return { ok: true, updated, scanned: bases.length };
}

// 未整備ストックに mod ファイルを登録（1操作で variant 作成＋ファイル添付）
export async function createVariantWithFile(
  baseFileId: string,
  formData: FormData,
): Promise<FormState> {
  const user = await requireHQ();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "ファイルを選択してください" };
  }

  // Cal 一致チェック（別の純正用ファイルの誤アップ防止）。force=true で上書き許可。
  const force = formData.get("force") === "true";
  if (!force) {
    const base = await prisma.baseFile.findUnique({
      where: { id: baseFileId },
      select: { calNumber: true, swNumber: true, ecu: true, manufacturer: true },
    });
    if (base && (base.calNumber || base.swNumber)) {
      const buf = Buffer.from(await file.arrayBuffer());
      const ecu = await smartExtractEcuId(buf, {
        hash: null,
        ecuType: base.ecu,
        manufacturer: base.manufacturer,
      });
      const norm = (s?: string | null) => (s ?? "").trim().toUpperCase().replace(/\s+/g, "");
      const fileCal = norm(ecu.cal);
      const baseCal = norm(base.calNumber);
      const fileSw = norm(ecu.sw);
      const baseSw = norm(base.swNumber);
      const calMismatch = !!baseCal && !!fileCal && fileCal !== baseCal;
      const swMismatch = !baseCal && !!baseSw && !!fileSw && fileSw !== baseSw;
      if (calMismatch || swMismatch) {
        return {
          error: `Cal が一致しません（ファイル: ${ecu.cal ?? ecu.sw ?? "不明"} ／ 純正: ${base.calNumber ?? base.swNumber}）。別の純正用ファイルの可能性があります。`,
        };
      }
    }
  }

  const saved = await saveUpload(file, "catalog/tuned");
  if (!saved.ok) return { error: saved.error };

  const stage = (String(formData.get("stage") ?? "")).trim();
  const options = (String(formData.get("options") ?? "")).trim();
  const popsRaw = formData.get("popsAndBangs");
  const popsAndBangs = popsRaw === "true" || popsRaw === "on" || popsRaw === "1";
  const sportRaw = formData.get("popsSport");
  const popsSport =
    popsAndBangs && (sportRaw === "true" || sportRaw === "on" || sportRaw === "1");
  let optionTags: string[] = [];
  try {
    const raw = formData.get("optionTags");
    if (typeof raw === "string" && raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) optionTags = arr.map((x) => String(x)).filter(Boolean);
    }
  } catch {
    /* 無視 */
  }

  const fileFields = {
    fileRef: saved.key,
    fileHash: saved.sha256,
    fileName: saved.filename,
    fileSize: saved.size,
    contentType: saved.contentType,
  };

  // 同じ構成（ステージ・バブリング・OPの集合一致）の既存版があれば新規作成せず差し替え。
  // 旧ファイルは版履歴(TunedVariantVersion)に残る。「登録済み → 差し替え」の挙動。
  const eqSet = (a: string[], b: string[]) =>
    a.length === b.length && [...a].sort().join("\n") === [...b].sort().join("\n");
  const sameConfig = (
    await prisma.tunedVariant.findMany({
      where: { baseFileId, deletedAt: null, stage, popsAndBangs, popsSport },
      select: {
        id: true,
        optionTags: true,
        versions: { select: { version: true }, orderBy: { version: "desc" }, take: 1 },
      },
    })
  ).find((v) => eqSet(v.optionTags ?? [], optionTags));
  if (sameConfig) {
    const nextVer = (sameConfig.versions[0]?.version ?? 0) + 1;
    const ver = await prisma.tunedVariantVersion.create({
      data: { variantId: sameConfig.id, version: nextVer, ...fileFields, replacedById: user.id },
    });
    await prisma.tunedVariant.update({
      where: { id: sameConfig.id },
      data: { currentVersionId: ver.id, status: "AVAILABLE", ...fileFields },
    });
    revalidatePath(CATALOG_PATH);
    revalidatePath(PENDING_PATH);
    return { ok: true, data: { variantId: sameConfig.id, replaced: true } };
  }

  const variant = await prisma.tunedVariant.create({
    data: {
      baseFileId,
      stage,
      options: options || null,
      popsAndBangs,
      popsSport,
      optionTags,
      // ファイル実体を添付して登録するので即・配布可（slave経路の版登録と同じ挙動）。
      // これで ori+mod をカタログからアップした純正が未整備ストックに残らない。
      status: "AVAILABLE",
      createdById: user.id,
    },
  });
  const ver = await prisma.tunedVariantVersion.create({
    data: {
      variantId: variant.id,
      version: 1,
      fileRef: saved.key,
      fileHash: saved.sha256,
      fileName: saved.filename,
      fileSize: saved.size,
      contentType: saved.contentType,
      replacedById: user.id,
    },
  });
  await prisma.tunedVariant.update({
    where: { id: variant.id },
    data: {
      currentVersionId: ver.id,
      fileRef: saved.key,
      fileHash: saved.sha256,
      fileName: saved.filename,
      fileSize: saved.size,
      contentType: saved.contentType,
    },
  });
  revalidatePath(CATALOG_PATH);
  revalidatePath(PENDING_PATH);
  return { ok: true, data: { variantId: variant.id } };
}

// 同じ要素集合か（順不同）
function sameTagSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((x, i) => x === sb[i]);
}

// 案件(施工記録)起点のバリエーション・アップロード。
// カタログ同様にステージ＋バブリング＋オプション(O2 等)を指定して、マッチした stock(BaseFile)
// 配下に variant を作成/差し替えし即・配布可(AVAILABLE)に。該当の未返却リクエストは納品＋通知。
// 選択は formData（stage / pops / optionTags(JSON)）で受け取る。
// 納品（リクエスト成果物）からのバリエーション自動登録。
// リクエスト内容ラベルを逆パースし、uploadVariation と同じ規則で
// 既存(同stage/pops/OP集合)を差し替え or 新規作成（いずれも配布可）。
export async function registerVariationFromDelivery(opts: {
  recordId: string;
  label: string;
  fileRef: string;
  fileHash: string;
  fileName: string | null;
  fileSize: number | null;
  contentType: string | null;
  userId: string;
}): Promise<{ ok?: true; skipped?: string }> {
  const sel = parseTuningContentLabel(opts.label);
  if (!sel) return { skipped: "リクエスト内容を解析できませんでした" };

  const record = await prisma.serviceRecord.findUnique({
    where: { id: opts.recordId },
    select: {
      matchedBaseFileId: true,
      matchedBaseFile: { select: { fuel: true, manufacturer: true } },
    },
  });
  if (!record?.matchedBaseFileId) {
    return { skipped: "施工記録がストックに紐づいていないため自動登録できません" };
  }
  const fuelKind = fuelKindOf(record.matchedBaseFile?.fuel);
  const allowed = new Set(optionTagsFor(fuelKind, record.matchedBaseFile?.manufacturer));
  const unknown = sel.optionTags.filter((t) => !allowed.has(t));
  if (unknown.length > 0) {
    return { skipped: `不明なオプション（${unknown.join("・")}）のため自動登録をスキップしました` };
  }
  const pops = popsAllowed(fuelKind) && sel.pops;
  const popsSport = pops && sel.popsSport;
  const optionTags = [...new Set(sel.optionTags)].sort();
  const baseFileId = record.matchedBaseFileId;

  const candidates = await prisma.tunedVariant.findMany({
    where: { baseFileId, stage: sel.stage, popsAndBangs: pops, popsSport, deletedAt: null },
    select: {
      id: true,
      status: true,
      optionTags: true,
      versions: { select: { version: true }, orderBy: { version: "desc" }, take: 1 },
    },
  });
  const matched = candidates.filter((c) => sameTagSet(c.optionTags, optionTags));
  const existing = matched.find((c) => c.status === "AVAILABLE") ?? matched[0];

  const fileFields = {
    fileRef: opts.fileRef,
    fileHash: opts.fileHash,
    fileName: opts.fileName,
    fileSize: opts.fileSize,
    contentType: opts.contentType,
  };

  if (existing) {
    const nextVer = (existing.versions[0]?.version ?? 0) + 1;
    const ver = await prisma.tunedVariantVersion.create({
      data: { variantId: existing.id, version: nextVer, ...fileFields, replacedById: opts.userId },
    });
    await prisma.tunedVariant.update({
      where: { id: existing.id },
      data: { status: "AVAILABLE", currentVersionId: ver.id, ...fileFields },
    });
  } else {
    const variant = await prisma.tunedVariant.create({
      data: {
        baseFileId,
        stage: sel.stage,
        popsAndBangs: pops,
        popsSport,
        optionTags,
        status: "AVAILABLE",
        createdById: opts.userId,
      },
    });
    const ver = await prisma.tunedVariantVersion.create({
      data: { variantId: variant.id, version: 1, ...fileFields, replacedById: opts.userId },
    });
    await prisma.tunedVariant.update({
      where: { id: variant.id },
      data: { currentVersionId: ver.id, ...fileFields },
    });
  }

  revalidatePath(CATALOG_PATH);
  revalidatePath(`/hq/records/${opts.recordId}`);
  revalidatePath(`/dealer/records/${opts.recordId}`);
  return { ok: true };
}

export async function uploadVariation(
  recordId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireHQ();

  const record = await prisma.serviceRecord.findUnique({
    where: { id: recordId },
    select: {
      id: true,
      matchedBaseFileId: true,
      dealerId: true,
      matchedBaseFile: { select: { fuel: true, manufacturer: true } },
    },
  });
  if (!record) return { error: "施工記録が見つかりません" };
  if (!record.matchedBaseFileId) {
    return { error: "この記録はストックに紐づいていません（照合未成立）" };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { error: "ファイルを選択してください" };

  // 選択（燃料に応じて正規化）
  const fuelKind = fuelKindOf(record.matchedBaseFile?.fuel);
  const stageVal = String(formData.get("stage") ?? "").trim();
  const popsRaw = formData.get("pops");
  const pops =
    popsAllowed(fuelKind) && (popsRaw === "1" || popsRaw === "true" || popsRaw === "on");
  const popsSportRaw = formData.get("popsSport");
  const popsSport = pops && (popsSportRaw === "1" || popsSportRaw === "true" || popsSportRaw === "on");
  let optionTags: string[] = [];
  try {
    const raw = formData.get("optionTags");
    if (typeof raw === "string" && raw) {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) optionTags = arr.map((x) => String(x));
    }
  } catch {
    /* 無視 */
  }
  const allowed = new Set(optionTagsFor(fuelKind, record.matchedBaseFile?.manufacturer));
  optionTags = [...new Set(optionTags)].filter((t) => allowed.has(t)).sort();

  const saved = await saveUpload(file, "catalog/tuned");
  if (!saved.ok) return { error: saved.error };

  const baseFileId = record.matchedBaseFileId;

  // 既存 (stage, pops, optionTags 集合一致) を探して差し替え、無ければ新規作成。いずれも AVAILABLE。
  // 重複データに備え AVAILABLE を優先する。
  const candidates = await prisma.tunedVariant.findMany({
    where: { baseFileId, stage: stageVal, popsAndBangs: pops, popsSport, deletedAt: null },
    select: {
      id: true,
      status: true,
      optionTags: true,
      versions: { select: { version: true }, orderBy: { version: "desc" }, take: 1 },
    },
  });
  const matched = candidates.filter((c) => sameTagSet(c.optionTags, optionTags));
  const existing = matched.find((c) => c.status === "AVAILABLE") ?? matched[0];

  const fileFields = {
    fileRef: saved.key,
    fileHash: saved.sha256,
    fileName: saved.filename,
    fileSize: saved.size,
    contentType: saved.contentType,
  };

  let variantId: string;
  if (existing) {
    const nextVer = (existing.versions[0]?.version ?? 0) + 1;
    const ver = await prisma.tunedVariantVersion.create({
      data: { variantId: existing.id, version: nextVer, ...fileFields, replacedById: user.id },
    });
    await prisma.tunedVariant.update({
      where: { id: existing.id },
      data: { status: "AVAILABLE", currentVersionId: ver.id, ...fileFields },
    });
    variantId = existing.id;
  } else {
    const variant = await prisma.tunedVariant.create({
      data: {
        baseFileId,
        stage: stageVal,
        popsAndBangs: pops,
        popsSport,
        optionTags,
        options: null,
        status: "AVAILABLE",
        createdById: user.id,
      },
    });
    const ver = await prisma.tunedVariantVersion.create({
      data: { variantId: variant.id, version: 1, ...fileFields, replacedById: user.id },
    });
    await prisma.tunedVariant.update({
      where: { id: variant.id },
      data: { currentVersionId: ver.id, ...fileFields },
    });
    variantId = variant.id;
  }

  // 同じ内容の未返却リクエストを納品扱いに（requestNote の「内容」で判定）
  const label = tuningContentLabel(stageVal, pops, optionTags, popsSport);
  const open = await prisma.fileRequest.findMany({
    where: {
      serviceRecordId: recordId,
      status: { notIn: ["DELIVERED", "CANCELLED"] },
      requestNote: { contains: `「${label}」` },
    },
    select: { id: true },
  });
  for (const req of open) {
    await prisma.fileRequest.update({
      where: { id: req.id },
      data: {
        status: "DELIVERED",
        events: {
          create: { status: "DELIVERED", actorId: user.id, comment: `「${label}」を配布可で納品` },
        },
      },
    });
    await notify({
      type: "REQUEST_DELIVERED",
      title: "依頼のファイルが準備できました",
      message: `「${label}」がダウンロード可能になりました。`,
      dealerId: record.dealerId,
      link: `/dealer/records/${recordId}`,
    });
  }
  // 納品したら代理店へ Web Push（アプリを閉じていても届く）
  if (open.length > 0) {
    after(async () => {
      const recipients = await recipientUserIds({ toHQ: false, dealerId: record.dealerId });
      await sendPushToUsers(recipients, {
        title: "依頼のファイルが届きました",
        body: `「${label}」がダウンロード可能になりました`,
        url: `/dealer/records/${recordId}`,
        tag: `deliver-${recordId}`,
      });
    });
  }

  revalidatePath(CATALOG_PATH);
  revalidatePath(PENDING_PATH);
  revalidatePath(`/hq/records/${recordId}`);
  revalidatePath(`/dealer/records/${recordId}`);
  return { ok: true, data: { variantId, delivered: open.length } };
}

// 案件のバリエーション削除（間違ってアップした版を消す）。
// 該当 (stage, pops, optionTags 集合一致) の variant をすべて削除する（重複データも一掃）。
export async function deleteVariation(
  recordId: string,
  stage: string,
  pops: boolean,
  optionTags: string[],
  popsSport = false,
): Promise<FormState> {
  await requireHQ();

  const record = await prisma.serviceRecord.findUnique({
    where: { id: recordId },
    select: { matchedBaseFileId: true },
  });
  if (!record?.matchedBaseFileId) return { error: "ストックに紐づいていません" };

  const want = [...new Set(optionTags.map((x) => String(x)))].sort();
  const candidates = await prisma.tunedVariant.findMany({
    where: {
      baseFileId: record.matchedBaseFileId,
      stage: stage.trim(),
      popsAndBangs: pops,
      popsSport: pops ? popsSport : false,
      deletedAt: null,
    },
    select: { id: true, optionTags: true },
  });
  const targets = candidates.filter((c) => sameTagSet(c.optionTags, want));
  if (targets.length === 0) return { error: "対象が見つかりません" };

  // ソフト削除（アーカイブ）。版・ファイルは保持し、復元可。
  await prisma.tunedVariant.updateMany({
    where: { id: { in: targets.map((t) => t.id) } },
    data: { deletedAt: new Date() },
  });

  revalidatePath(CATALOG_PATH);
  revalidatePath(PENDING_PATH);
  revalidatePath(`/hq/records/${recordId}`);
  revalidatePath(`/dealer/records/${recordId}`);
  return { ok: true, data: { deleted: targets.length } };
}

// 候補(未整備ストック)の却下/復帰
export async function archiveBaseFile(baseFileId: string): Promise<FormState> {
  await requireHQ();
  await prisma.baseFile.update({ where: { id: baseFileId }, data: { archived: true } });
  revalidatePath(PENDING_PATH);
  return { ok: true };
}
export async function unarchiveBaseFile(baseFileId: string): Promise<FormState> {
  await requireHQ();
  await prisma.baseFile.update({ where: { id: baseFileId }, data: { archived: false } });
  revalidatePath(PENDING_PATH);
  return { ok: true };
}

// 純正(ストック)を手動登録。原本ファイルを上げれば SHA-256 を stockHash に確定、
// 無ければ stockHash を手入力（任意）。作成後は「未整備ストック」に並び、mod を足せる。
export async function createBaseFileManual(formData: FormData): Promise<FormState> {
  const user = await requireHQ();
  const manufacturer = String(formData.get("manufacturer") ?? "").trim();
  const model = String(formData.get("model") ?? "").trim();
  const ecu = String(formData.get("ecu") ?? "").trim();
  const mcu = String(formData.get("mcu") ?? "").trim();
  let stockHash: string | null = String(formData.get("stockHash") ?? "").trim() || null;
  if (!manufacturer || !model || !ecu) {
    return { error: "メーカー・車種・ECU は必須です" };
  }

  let stockFields: Record<string, unknown> = {};
  const file = formData.get("file");
  if (file instanceof File && file.size > 0) {
    const saved = await saveUpload(file, "catalog/stock");
    if (!saved.ok) return { error: saved.error };
    stockHash = saved.sha256; // 原本から指紋を確定
    stockFields = {
      stockFileRef: saved.key,
      stockFileName: saved.filename,
      stockFileSize: saved.size,
      stockContentType: saved.contentType,
    };
  }

  try {
    const base = await prisma.baseFile.create({
      data: {
        manufacturer,
        model,
        ecu,
        mcu: mcu || null,
        stockHash,
        source: "MANUAL",
        createdById: user.id,
        ...stockFields,
      },
    });
    revalidatePath(PENDING_PATH);
    revalidatePath(CATALOG_PATH);
    return { ok: true, data: { id: base.id } };
  } catch (e) {
    if (isUniqueError(e)) return { error: "同じ stockHash の項目が既に存在します" };
    throw e;
  }
}

// 未整備ストック画面の「登録済みバリエーション」テーブル1行分。
export type StockVariantRow = {
  id: string;
  stage: string;
  popsAndBangs: boolean;
  popsSport: boolean;
  optionTags: string[];
  status: string;
  fileName: string | null;
  label: string;
};

async function stockVariantRows(baseFileId: string): Promise<StockVariantRow[]> {
  const vs = await prisma.tunedVariant.findMany({
    where: { baseFileId, deletedAt: null },
    orderBy: [{ stage: "asc" }, { popsAndBangs: "asc" }, { popsSport: "asc" }],
    select: {
      id: true,
      stage: true,
      popsAndBangs: true,
      popsSport: true,
      optionTags: true,
      status: true,
      fileName: true,
    },
  });
  return vs.map((v) => ({
    id: v.id,
    stage: v.stage,
    popsAndBangs: v.popsAndBangs,
    popsSport: v.popsSport,
    optionTags: v.optionTags ?? [],
    status: v.status as string,
    fileName: v.fileName ?? null,
    label: tuningContentLabel(v.stage, v.popsAndBangs, v.optionTags ?? [], v.popsSport),
  }));
}

// 登録済みバリエーションの最新一覧を取得（差し替え/削除後の再描画用）。
export async function listStockVariants(
  baseFileId: string,
): Promise<{ variants: StockVariantRow[] }> {
  await requireHQ();
  return { variants: await stockVariantRows(baseFileId) };
}

// この純正が .slave 化できるか（取込元記録に AutoTuner の車固有IDが揃っているか）。
async function baseCanSlave(baseFileId: string): Promise<boolean> {
  const base = await prisma.baseFile.findUnique({
    where: { id: baseFileId },
    select: { capturedFromRecordId: true },
  });
  if (!base?.capturedFromRecordId) return false;
  const rec = await prisma.serviceRecord.findUnique({
    where: { id: base.capturedFromRecordId },
    select: {
      autotunerSlaveId: true,
      autotunerEcuId: true,
      autotunerModelId: true,
      autotunerMcuId: true,
    },
  });
  return (
    !!rec?.autotunerSlaveId &&
    rec.autotunerEcuId != null &&
    rec.autotunerModelId != null &&
    !!rec.autotunerMcuId
  );
}

// 既存ストックへの顧客登録（重複アップ時に後から登録できる）。
// 本店施工として 施工記録(本店ダミー代理店) を作成し recordId を返す。
export async function registerHqCustomerForBase(
  baseFileId: string,
  formData: FormData,
): Promise<{ ok?: true; recordId?: string; error?: string }> {
  const user = await requireHQ();
  const customerName = String(formData.get("customerName") ?? "").trim();
  if (!customerName) return { error: "顧客名を入力してください" };
  const workedAtRaw = String(formData.get("workedAt") ?? "").trim();
  const unit = formData.get("unit") === "TCU" ? "TCU" : "ECU";

  const base = await prisma.baseFile.findUnique({
    where: { id: baseFileId },
    select: {
      manufacturer: true,
      model: true,
      hwNumber: true,
      swNumber: true,
      calNumber: true,
    },
  });
  if (!base) return { error: "純正(BaseFile)が見つかりません" };

  const recordId = await createHqServiceRecord({
    baseFileId,
    manufacturer: base.manufacturer,
    model: base.model,
    unit,
    customerName,
    workedAtRaw,
    userId: user.id,
    hw: base.hwNumber,
    sw: base.swNumber,
    cal: base.calNumber,
  });
  revalidatePath("/hq/records");
  return { ok: true, recordId };
}

// 原本(純正)binを解析して ECU 識別子を先読み（フォーム自動入力用）。DBは触らない。
export async function analyzeStockBin(formData: FormData): Promise<{
  ok?: true;
  ecu: string | null;
  sw: string | null;
  cal: string | null;
  hw: string | null;
  displacement: string | null;
  fuel: string | null;
  // 同一内容(stockHash)の純正が既にカタログ/未整備にある場合はその情報を返す
  // → クライアントはバリエーション登録画面へ自動切替する
  existing?: {
    id: string;
    manufacturer: string;
    model: string;
    fuel: string | null;
    cal: string | null;
    sw: string | null;
    // 登録済みバリエーション（テーブル表示用の全項目）
    variants: StockVariantRow[];
    // .slave 化できるか（取込元の車固有IDが揃っている場合のみ）
    canSlave: boolean;
  } | null;
  error?: string;
}> {
  await requireHQ();
  const file = formData.get("file");
  const empty = { ecu: null, sw: null, cal: null, hw: null, displacement: null, fuel: null };
  if (!(file instanceof File) || file.size === 0) {
    return { ...empty, error: "ファイルを選択してください" };
  }
  const buf = Buffer.from(await file.arrayBuffer());
  const hash = createHash("sha256").update(buf).digest("hex");
  const ecu = await smartExtractEcuId(buf, { hash, ecuType: null });
  const desc = ecu.engineDesc ?? "";
  const dm = desc.match(/(\d(?:\.\d)?)\s*l\b/i);
  const fuel = /TDI|diesel/i.test(desc)
    ? "diesel"
    : /TFSI|TSI|FSI|petrol|gasoline/i.test(desc)
      ? "petrol"
      : null;

  // 既にストック済み（同一hash・却下されていない）なら、その純正の情報を返して
  // クライアント側でバリエーション登録画面へ直行させる（二重登録の手間をなくす）
  // ※ 自動取込(復号)の stockHash は大文字・カタログ計算は小文字なので両方で照合する
  const dup = await prisma.baseFile.findFirst({
    where: { stockHash: { in: [hash, hash.toUpperCase()] } },
    select: {
      id: true,
      archived: true,
      manufacturer: true,
      model: true,
      fuel: true,
      calNumber: true,
      swNumber: true,
    },
  });
  let existing = null;
  if (dup && !dup.archived) {
    existing = {
      id: dup.id,
      manufacturer: dup.manufacturer,
      model: dup.model,
      fuel: dup.fuel,
      cal: dup.calNumber,
      sw: dup.swNumber,
      variants: await stockVariantRows(dup.id),
      canSlave: await baseCanSlave(dup.id),
    };
  }

  return {
    ok: true,
    ecu: ecu.ecuType,
    sw: ecu.sw,
    cal: ecu.cal,
    hw: ecu.hw,
    displacement: dm ? `${dm[1]}L` : null,
    fuel,
    existing,
  };
}

// 純正binアップ用: Opusで メーカー・車種・世代・グレード・HW/SW/Cal をまとめて推定（本店のみ）。
// フォームの自動入力に使う。パターンは ECU型番/エンジン記述/燃料のヒントに使う。
export async function analyzeStockBinAi(formData: FormData): Promise<{
  ok?: true;
  error?: string;
  manufacturer?: string | null;
  model?: string | null;
  generation?: string | null;
  grade?: string | null;
  hw?: string | null;
  sw?: string | null;
  cal?: string | null;
  ecu?: string | null;
  fuel?: string | null;
  displacement?: string | null;
  confidence?: number;
}> {
  await requireHQ();
  if (!aiEnabled()) {
    return { error: "AIキー(ANTHROPIC_API_KEY)が未設定です。サーバに設定してください。" };
  }
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "ファイルを選択してください" };
  }
  const buf = Buffer.from(await file.arrayBuffer());
  const hash = createHash("sha256").update(buf).digest("hex");
  const pattern = await smartExtractEcuId(buf, { hash, ecuType: null });
  const desc = pattern.engineDesc ?? "";
  const dm = desc.match(/(\d(?:\.\d)?)\s*l\b/i);
  const fuel = /TDI|diesel/i.test(desc)
    ? "diesel"
    : /TFSI|TSI|FSI|petrol|gasoline/i.test(desc)
      ? "petrol"
      : null;
  let ai;
  try {
    ai = await aiAnalyzeStock(buf, {
      hash,
      swHint: pattern.sw,
      calHint: pattern.cal,
      engineDesc: pattern.engineDesc,
      throwOnError: true,
    });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "AI呼び出しに失敗しました" };
  }
  if (!ai) return { error: "AIで認識できませんでした。手入力してください。" };

  // メーカー表記は正規化（Mercedes系→Mercedes 等）
  const manufacturer = ai.manufacturer
    ? normalizeManufacturer(
        ai.manufacturer,
        (await prisma.baseFile.findMany({ distinct: ["manufacturer"], select: { manufacturer: true } })).map(
          (b) => b.manufacturer,
        ),
      )
    : null;

  return {
    ok: true,
    manufacturer,
    model: ai.model,
    generation: ai.generation,
    grade: ai.grade,
    hw: ai.hw,
    sw: ai.sw,
    cal: ai.cal,
    ecu: pattern.ecuType, // ECU型番はパターンの方が確実
    fuel,
    displacement: dm ? `${dm[1]}L` : null,
    confidence: ai.confidence,
  };
}

// 本店施工の案件化: カタログの純正アップで顧客名が入力されたら、「本店」名義の
// 施工記録(MANUAL)を作って顧客別管理に乗せる（slaveアップと同等の顧客名・施工日）。
async function createHqServiceRecord(opts: {
  baseFileId: string;
  manufacturer: string;
  model: string;
  unit: string;
  customerName: string;
  workedAtRaw: string;
  userId: string;
  hw?: string | null;
  sw?: string | null;
  cal?: string | null;
}): Promise<string> {
  let hq = await prisma.dealer.findFirst({ where: { name: "本店" }, select: { id: true } });
  if (!hq) {
    hq = await prisma.dealer.create({
      data: { name: "本店", note: "本店施工（カタログの純正アップ由来）" },
      select: { id: true },
    });
  }
  let workedAt: Date | undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(opts.workedAtRaw)) {
    const d = new Date(`${opts.workedAtRaw}T12:00:00+09:00`);
    if (!Number.isNaN(d.getTime())) workedAt = d;
  }
  const rec = await prisma.serviceRecord.create({
    data: {
      dealerId: hq.id,
      createdById: opts.userId,
      source: "MANUAL",
      status: "DECODED",
      carMaker: opts.manufacturer,
      carModel: opts.model,
      customerName: opts.customerName,
      unit: opts.unit,
      matchedBaseFileId: opts.baseFileId,
      hwNumber: opts.hw ?? null,
      swNumber: opts.sw ?? null,
      calNumber: opts.cal ?? null,
      ...(workedAt ? { workedAt } : {}),
    },
    select: { id: true },
  });
  revalidatePath("/hq/records");
  return rec.id;
}

// 原本(純正)binをアップして BaseFile(カタログのベース)を新規作成。
// ECU/SW/Cal/HW・stockHash は bin から自動抽出。メーカー/車種は手入力（表記揺れを正規化）。
// エンジン型式・排気量・世代は任意。これに mod(TunedVariant) がぶら下がる。
export async function createBaseFileFromBin(formData: FormData): Promise<FormState> {
  const user = await requireHQ();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "原本(純正)ファイルを選択してください" };
  }
  const model = String(formData.get("model") ?? "").trim();
  if (!model) return { error: "車種は必須です" };
  const makerInput = String(formData.get("manufacturer") ?? "").trim();
  if (!makerInput) return { error: "メーカーは必須です" };

  // メーカー表記を正規化（同一メーカーの重複登録を防止）
  const existingMakers = (
    await prisma.baseFile.findMany({ distinct: ["manufacturer"], select: { manufacturer: true } })
  ).map((b) => b.manufacturer);
  const manufacturer = normalizeManufacturer(makerInput, existingMakers);

  // bin から識別子抽出（組み込み＋学習）＋指紋確定
  const buf = Buffer.from(await file.arrayBuffer());
  const stockHash = createHash("sha256").update(buf).digest("hex");
  const typedEcu = String(formData.get("ecu") ?? "").trim();
  const ecu = await smartExtractEcuId(buf, {
    hash: stockHash,
    ecuType: typedEcu || null,
    manufacturer, // ベンツは自動Cal認識を無効化（手入力のみ）
  });
  const saved = await saveUpload(file, "catalog/stock");
  if (!saved.ok) return { error: saved.error };

  const desc = ecu.engineDesc ?? "";
  const inferredFuel = /TDI|diesel/i.test(desc)
    ? "diesel"
    : /TFSI|TSI|FSI|petrol|gasoline/i.test(desc)
      ? "petrol"
      : null;
  const ecuType = String(formData.get("ecu") ?? "").trim() || ecu.ecuType || "(不明)";
  const mcu = String(formData.get("mcu") ?? "").trim() || null;
  const generation = String(formData.get("generation") ?? "").trim() || null;
  const grade = String(formData.get("grade") ?? "").trim() || null;
  const engineCode = String(formData.get("engineCode") ?? "").trim() || ecu.engineCode || null;
  const displacement = String(formData.get("displacement") ?? "").trim() || null;
  const fuel = String(formData.get("fuel") ?? "").trim() || inferredFuel;

  // ECU識別子: 手入力があれば優先（自動認識しない時にアップ画面で補える）
  const typedHw = String(formData.get("hwNumber") ?? "").trim();
  const typedSw = String(formData.get("swNumber") ?? "").trim();
  const typedCal = String(formData.get("calNumber") ?? "").trim();
  const hwNumber = typedHw || ecu.hw;
  const swNumber = typedSw || ecu.sw;
  const calNumber = typedCal || ecu.cal;
  const manualId = !!(typedHw || typedSw || typedCal);
  // 対象ユニット(ECU/TCU) と、本店施工の案件化用の顧客名・施工日（任意）
  const unit = formData.get("unit") === "TCU" ? "TCU" : "ECU";
  const customerName = String(formData.get("customerName") ?? "").trim();
  const workedAtRaw = String(formData.get("workedAt") ?? "").trim();

  const swSeq = swNumber ? await prisma.baseFile.count({ where: { swNumber } }) : 0;

  // 同一hashの既存純正があれば：現役ならエラーにせず既存のバリエーション登録へ誘導、
  // 却下(archived)済みなら復帰して上書き。
  // ※ 自動取込(復号)の stockHash は大文字・ここの計算は小文字なので両方で照合する
  const dup = await prisma.baseFile.findFirst({
    where: { stockHash: { in: [stockHash, stockHash.toUpperCase()] } },
    select: {
      id: true,
      archived: true,
      manufacturer: true,
      model: true,
      fuel: true,
      calNumber: true,
      swNumber: true,
    },
  });
  if (dup) {
    if (!dup.archived) {
      // 既にストック済み → その純正の mod 登録画面へ直行（顧客名があれば本店案件も作る）
      let recId: string | undefined;
      if (customerName) {
        recId = await createHqServiceRecord({
          baseFileId: dup.id, manufacturer: dup.manufacturer, model: dup.model, unit,
          customerName, workedAtRaw, userId: user.id, hw: hwNumber, sw: swNumber, cal: calNumber,
        });
      }
      return {
        ok: true,
        data: {
          id: dup.id,
          existing: true,
          manufacturer: dup.manufacturer,
          model: dup.model,
          fuel: dup.fuel,
          cal: dup.calNumber,
          sw: dup.swNumber,
          recordId: recId,
          variants: await stockVariantRows(dup.id),
          canSlave: await baseCanSlave(dup.id),
        },
      };
    }
    const revived = await prisma.baseFile.update({
      where: { id: dup.id },
      data: {
        archived: false,
        manufacturer,
        model,
        ecu: ecuType,
        mcu,
        hwNumber,
        swNumber,
        swSeq,
        calNumber,
        generation,
        grade,
        engineCode,
        displacement,
        fuel,
        unit,
        stockFileRef: saved.key,
        stockFileName: saved.filename,
        stockFileSize: saved.size,
        stockContentType: saved.contentType,
        note: "純正binアップロードで再登録（却下から復帰）",
      },
    });
    if (manualId) {
      after(async () => {
        await learnEcuRules({
          buf,
          hash: stockHash,
          ecuType,
          hw: hwNumber,
          sw: swNumber,
          cal: calNumber,
          sourceBaseFileId: revived.id,
        });
      });
    }
    // 顧客名があれば「本店」名義の施工記録を作る（本店施工の顧客別管理）
    let revRecordId: string | undefined;
    if (customerName) {
      revRecordId = await createHqServiceRecord({
        baseFileId: revived.id, manufacturer, model, unit, customerName, workedAtRaw,
        userId: user.id, hw: hwNumber, sw: swNumber, cal: calNumber,
      });
    }
    revalidatePath(CATALOG_PATH);
    revalidatePath(PENDING_PATH);
    return { ok: true, data: { id: revived.id, recordId: revRecordId } };
  }

  try {
    const base = await prisma.baseFile.create({
      data: {
        stockHash,
        manufacturer,
        model,
        ecu: ecuType,
        mcu,
        hwNumber,
        swNumber,
        swSeq,
        calNumber,
        generation,
        grade,
        engineCode,
        displacement,
        fuel,
        unit,
        source: "MANUAL",
        createdById: user.id,
        stockFileRef: saved.key,
        stockFileName: saved.filename,
        stockFileSize: saved.size,
        stockContentType: saved.contentType,
        note: "純正binアップロードで登録",
      },
    });
    // 手入力で識別子を補ったら学習（次回以降の自動認識用・外部API不要）
    if (manualId) {
      after(async () => {
        await learnEcuRules({
          buf,
          hash: stockHash,
          ecuType,
          hw: hwNumber,
          sw: swNumber,
          cal: calNumber,
          sourceBaseFileId: base.id,
        });
      });
    }
    // 顧客名があれば「本店」名義の施工記録を作る（本店施工の顧客別管理）
    let recordId: string | undefined;
    if (customerName) {
      recordId = await createHqServiceRecord({
        baseFileId: base.id, manufacturer, model, unit, customerName, workedAtRaw,
        userId: user.id, hw: hwNumber, sw: swNumber, cal: calNumber,
      });
    }
    revalidatePath(CATALOG_PATH);
    revalidatePath(PENDING_PATH);
    return { ok: true, data: { id: base.id, recordId } };
  } catch (e) {
    if (isUniqueError(e)) return { error: "同じ識別子の項目が既に存在します" };
    throw e;
  }
}

// 原本（ストック）ファイルのアップロード。SHA-256 を stockHash に設定（照合キー）。
export async function uploadStockFile(
  baseFileId: string,
  formData: FormData,
): Promise<FormState> {
  await requireHQ();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { error: "ファイルを選択してください" };
  }
  const saved = await saveUpload(file, "catalog/stock");
  if (!saved.ok) return { error: saved.error };
  try {
    await prisma.baseFile.update({
      where: { id: baseFileId },
      data: {
        stockFileRef: saved.key,
        stockFileName: saved.filename,
        stockFileSize: saved.size,
        stockContentType: saved.contentType,
        stockHash: saved.sha256,
      },
    });
  } catch (e) {
    if (isUniqueError(e)) {
      return { error: "同じ stockHash(原本) の項目が既に存在します" };
    }
    throw e;
  }
  revalidatePath(CATALOG_PATH);
  return { ok: true };
}
