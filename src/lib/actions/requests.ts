"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireDealer, requireHQ } from "@/lib/authz";
import {
  fileRequestSchema,
  hqRequestUpdateSchema,
} from "@/lib/validation/request";
import { type FormState, zodToFieldErrors } from "@/lib/actions/form-state";
import { saveUpload } from "@/server/storage";
import { notify } from "@/server/notifications";
import { requestStatusLabels } from "@/lib/labels";
import {
  type FuelKind,
  fuelKindOf,
  optionTagsFor,
  popsAllowed,
  tuningContentLabel,
} from "@/lib/catalog/options";

// ── 代理店: 依頼作成 ───────────────────────────
export async function createFileRequest(
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireDealer();

  const parsed = fileRequestSchema.safeParse({
    title: formData.get("title"),
    carInfo: formData.get("carInfo"),
    vin: formData.get("vin"),
    ecuType: formData.get("ecuType"),
    requestNote: formData.get("requestNote"),
  });
  if (!parsed.success) {
    return { error: "入力内容を確認してください", fieldErrors: zodToFieldErrors(parsed.error) };
  }

  // 入力ファイル（任意）
  let inputFilePath: string | undefined;
  const file = formData.get("inputFile");
  if (file instanceof File && file.size > 0) {
    const res = await saveUpload(file, "requests");
    if (!res.ok) return { error: res.error, fieldErrors: { inputFile: res.error } };
    inputFilePath = res.key;
  }

  const req = await prisma.fileRequest.create({
    data: {
      dealerId: user.dealerId,
      title: parsed.data.title,
      carInfo: parsed.data.carInfo,
      vin: parsed.data.vin,
      ecuType: parsed.data.ecuType,
      requestNote: parsed.data.requestNote,
      inputFilePath,
      status: "RECEIVED",
      events: {
        create: { status: "RECEIVED", actorId: user.id, comment: "依頼作成" },
      },
    },
  });

  await notify({
    type: "REQUEST_CREATED",
    title: "新しい作業依頼があります",
    message: `${user.name ?? "代理店"} より「${req.title}」`,
    dealerId: null, // 本店宛て
    link: `/hq/requests/${req.id}`,
  });

  revalidatePath("/dealer/requests");
  redirect(`/dealer/requests/${req.id}`);
}

// ── 代理店: 施工内容の構成（コンフィギュレータ） ───────────────
// 代理店はステージ/バブリング/OP(O2 等)を選ぶ。選択ごとに resolveTuning で
// 「即DL可能(配布可＋実体＋再暗号化IDが揃う)」か「本店へリクエスト」かを返す。
// 1行ずつ全通りは出さず、選んだ1構成だけを判定する。Cal/ECU 等の専門情報は出さない。

export type TuningSelection = { stage: string; pops: boolean; optionTags: string[] };

// 同じ要素集合か（順不同）
function sameSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].sort();
  const sb = [...b].sort();
  return sa.every((x, i) => x === sb[i]);
}

// 照合済み記録の文脈（所有確認・燃料・再暗号化可否）をまとめて取得
async function loadMatchContext(recordId: string, dealerId: string) {
  const record = await prisma.serviceRecord.findUnique({
    where: { id: recordId },
    select: {
      dealerId: true,
      matchedBaseFileId: true,
      carMaker: true,
      carModel: true,
      vin: true,
      autotunerSlaveId: true,
      autotunerEcuId: true,
      autotunerModelId: true,
      autotunerMcuId: true,
      matchedBaseFile: { select: { fuel: true } },
    },
  });
  if (!record || record.dealerId !== dealerId)
    return { ok: false as const, error: "記録が見つかりません" };
  if (!record.matchedBaseFileId)
    return { ok: false as const, error: "照合が成立していません" };
  const fuelKind = fuelKindOf(record.matchedBaseFile?.fuel);
  const canDeliver =
    !!record.autotunerSlaveId &&
    record.autotunerEcuId != null &&
    record.autotunerModelId != null &&
    !!record.autotunerMcuId;
  return { ok: true as const, record, fuelKind, canDeliver, baseFileId: record.matchedBaseFileId };
}

// 選択を燃料に応じて正規化（許可されないタグ/バブリングは落とす）
function normalizeSelection(sel: TuningSelection, fuelKind: FuelKind): TuningSelection {
  const allowed = new Set(optionTagsFor(fuelKind));
  const optionTags = [...new Set(sel.optionTags)].filter((t) => allowed.has(t));
  return {
    stage: (sel.stage ?? "").trim(),
    pops: popsAllowed(fuelKind) ? !!sel.pops : false,
    optionTags,
  };
}

// 施工内容の人間可読ラベル（専門情報なし）
function contentLabel(sel: TuningSelection): string {
  return tuningContentLabel(sel.stage, sel.pops, sel.optionTags);
}

// 選択構成 → 即DL or リクエスト判定
export async function resolveTuning(
  recordId: string,
  selection: TuningSelection,
): Promise<{ kind: "download"; href: string } | { kind: "request" } | { error: string }> {
  const user = await requireDealer();
  const ctx = await loadMatchContext(recordId, user.dealerId);
  if (!ctx.ok) return { error: ctx.error };

  const sel = normalizeSelection(selection, ctx.fuelKind);

  // 配布可(AVAILABLE)＋実体ありの中から、選んだ構成に完全一致する版を探す
  const variants = await prisma.tunedVariant.findMany({
    where: { baseFileId: ctx.baseFileId, status: "AVAILABLE" },
    select: { id: true, stage: true, popsAndBangs: true, optionTags: true, fileRef: true },
  });
  const hit = variants.find(
    (v) =>
      (v.stage ?? "").trim() === sel.stage &&
      v.popsAndBangs === sel.pops &&
      sameSet(v.optionTags, sel.optionTags),
  );
  if (hit && hit.fileRef && ctx.canDeliver) {
    return { kind: "download", href: `/api/match/${recordId}/variant/${hit.id}` };
  }
  return { kind: "request" };
}

// 選択構成を本店へリクエスト（任意の組合せ可。Cal/ECU は含めない）。
// バブリング以外のオプション(NOx/DTC/O2/AdBlue/DPF/EGR)は有料のため、
// 含まれる場合は同意(agreed)が必須。未同意ならリクエストを作成しない。
export async function requestTuning(
  recordId: string,
  selection: TuningSelection,
  agreed = false,
): Promise<{ ok?: true; error?: string }> {
  const user = await requireDealer();
  const ctx = await loadMatchContext(recordId, user.dealerId);
  if (!ctx.ok) return { error: ctx.error };

  const sel = normalizeSelection(selection, ctx.fuelKind);
  // 正規化後の optionTags はすべて有料OP（バブリングは pops で別枠＝無料）。
  if (sel.optionTags.length > 0 && !agreed) {
    return { error: "有料オプションの同意が必要です" };
  }
  const content = contentLabel(sel);
  const car = [ctx.record.carMaker, ctx.record.carModel].filter(Boolean).join(" ") || "車両";
  const title = `${car} ${content}`;

  // 同一記録×同一内容の未完了リクエストがあれば二重作成しない
  const dup = await prisma.fileRequest.findFirst({
    where: {
      dealerId: user.dealerId,
      serviceRecordId: recordId,
      title,
      status: { notIn: ["DELIVERED", "CANCELLED"] },
    },
    select: { id: true },
  });
  if (dup) return { error: "この施工内容は既にリクエスト済みです" };

  const req = await prisma.fileRequest.create({
    data: {
      dealerId: user.dealerId,
      title,
      carInfo: car,
      vin: ctx.record.vin,
      requestNote: `照合済み記録から「${content}」の作成を依頼`,
      serviceRecordId: recordId,
      status: "RECEIVED",
      events: { create: { status: "RECEIVED", actorId: user.id, comment: "適合リクエスト" } },
    },
  });

  await notify({
    type: "REQUEST_CREATED",
    title: "適合ファイルのリクエストがあります",
    message: `${user.name ?? "代理店"} より「${title}」`,
    dealerId: null, // 本店宛て
    link: `/hq/requests/${req.id}`,
  });

  revalidatePath(`/dealer/records/${recordId}`);
  return { ok: true };
}

// ── 代理店: 記録から「調整/現車合わせ」チケットを起票（自由記述＋ログ添付） ──
// 例:「もっと大きいバブリングが欲しい」「ログ取った結果◯◯なので濃いめに」。
// FileRequest を流用し、記録に紐づける。本店はこの内容＋ログを見て専用ファイルを納品する。
export async function createRecordTicket(
  recordId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireDealer();
  const record = await prisma.serviceRecord.findUnique({
    where: { id: recordId },
    select: { dealerId: true, carMaker: true, carModel: true, vin: true },
  });
  if (!record || record.dealerId !== user.dealerId) {
    return { error: "対象の記録が見つかりません" };
  }

  const kind = String(formData.get("kind") ?? "adjust"); // adjust | custom
  const kindLabel = kind === "custom" ? "現車合わせ(ログ反映)" : "調整リクエスト";
  const content = String(formData.get("content") ?? "").trim();
  if (!content) {
    return { error: "内容を入力してください", fieldErrors: { content: "必須" } };
  }

  // ログ/参考ファイル（任意）
  let inputFilePath: string | undefined;
  const file = formData.get("logFile");
  if (file instanceof File && file.size > 0) {
    const res = await saveUpload(file, "requests");
    if (!res.ok) return { error: res.error, fieldErrors: { logFile: res.error } };
    inputFilePath = res.key;
  }

  const car = [record.carMaker, record.carModel].filter(Boolean).join(" ") || "車両";
  const title = `${car} ${kindLabel}`;

  const req = await prisma.fileRequest.create({
    data: {
      dealerId: user.dealerId,
      title,
      carInfo: car,
      vin: record.vin,
      requestNote: `【${kindLabel}】\n${content}`,
      inputFilePath,
      serviceRecordId: recordId,
      status: "RECEIVED",
      events: { create: { status: "RECEIVED", actorId: user.id, comment: kindLabel } },
    },
  });

  await notify({
    type: "REQUEST_CREATED",
    title: `${kindLabel}があります`,
    message: `${user.name ?? "代理店"} より「${title}」`,
    dealerId: null, // 本店宛て
    link: `/hq/requests/${req.id}`,
  });

  revalidatePath(`/dealer/records/${recordId}`);
  return { ok: true };
}

// ── 本店: 依頼更新（ステータス/コメント/成果ファイル/紐付け） ──
export async function updateRequestByHQ(
  requestId: string,
  _prev: FormState,
  formData: FormData,
): Promise<FormState> {
  const user = await requireHQ();

  const parsed = hqRequestUpdateSchema.safeParse({
    status: formData.get("status"),
    hqNote: formData.get("hqNote"),
    serviceRecordId: formData.get("serviceRecordId"),
  });
  if (!parsed.success) {
    return { error: "入力内容を確認してください", fieldErrors: zodToFieldErrors(parsed.error) };
  }

  const current = await prisma.fileRequest.findUnique({
    where: { id: requestId },
    select: { status: true, dealerId: true, resultFilePath: true },
  });
  if (!current) return { error: "依頼が見つかりません" };

  // 成果ファイル（任意・差し替え可）
  let resultFilePath = current.resultFilePath ?? undefined;
  const file = formData.get("resultFile");
  if (file instanceof File && file.size > 0) {
    const res = await saveUpload(file, "requests");
    if (!res.ok) return { error: res.error, fieldErrors: { resultFile: res.error } };
    resultFilePath = res.key;
  }

  const { status, hqNote, serviceRecordId } = parsed.data;

  await prisma.fileRequest.update({
    where: { id: requestId },
    data: {
      status,
      hqNote,
      resultFilePath,
      serviceRecordId: serviceRecordId || null,
      // ステータスが変わった時だけ監査イベントを追加
      ...(status !== current.status
        ? { events: { create: { status, actorId: user.id, comment: hqNote } } }
        : {}),
    },
  });

  // ステータス変更を代理店へ通知
  if (status !== current.status) {
    await notify({
      type: status === "DELIVERED" ? "REQUEST_DELIVERED" : "REQUEST_STATUS_CHANGED",
      title: `依頼ステータス: ${requestStatusLabels[status]}`,
      message: `依頼の状態が「${requestStatusLabels[status]}」に更新されました。`,
      dealerId: current.dealerId,
      link: `/dealer/requests/${requestId}`,
    });
  }

  revalidatePath("/hq/requests");
  revalidatePath(`/hq/requests/${requestId}`);
  revalidatePath(`/dealer/requests/${requestId}`);
  return { ok: true };
}
