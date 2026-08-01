/*
 * 施工証明書の作成・発行・参照（唯一の入口）。
 *
 * 設計の要点:
 *  - **公開ブログには何も渡さない**。公開側へ出す値は cert-visibility.ts のDTOだけを使う
 *  - 発行後は内容を変更できない（訂正は voided にして replacesId 付きで再発行）
 *  - 失敗を沈黙させない。status=failed と errorMessage を残し、画面から再試行できる
 *  - 保存期間は resolveRetention に従う（法定記録簿=2年 / 保証=満了日まで。退会でも消さない）
 *  - ハッシュは平文の車台番号を使わず vehicleKey（HMAC）で作る。
 *    → 鍵ローテーションや再暗号化で値が変わらず、復号も要らない
 *  - 店舗スコープは storeId を必ず where に含める（customer-repo.ts と同じ方針）
 */
import { randomBytes } from "node:crypto";
import { prisma } from "@/lib/db";
import { moduleDef, validateModuleValues, moduleAdvice, isLegalRecordFacility } from "@/server/pit/cert-fields";
import { reviewCopy } from "@/server/pit/copy-guard";
import { resolveRetention } from "@/server/pit/cert-retention";
import { certificateNo, certificatePayloadHash } from "@/server/pit/cert-hash";
import { missingLegalFields } from "@/server/pit/legal-record";

// ハッシュ計算はDB非依存の cert-hash.ts が原本（検証スクリプトから単体で呼べるように分離）
export { certificatePayloadHash } from "@/server/pit/cert-hash";

export const CERTIFICATE_TYPES = [
  { key: "coating", label: "コーティング・PPF" },
  { key: "ecu", label: "ECUチューニング" },
  { key: "aiming", label: "エーミング" },
  { key: "tire", label: "タイヤ" },
  { key: "repair_history", label: "修復歴" },
  { key: "battery", label: "駆動用バッテリー" },
  { key: "general", label: "その他の施工" },
] as const;

export function certificateTypeLabel(key: string): string {
  return CERTIFICATE_TYPES.find((t) => t.key === key)?.label ?? key;
}

export type CertificateCoreInput = {
  vehicleId: string;
  customerId: string;
  certificateType: string;
  serviceDate: string; // YYYY-MM-DD
  odometerKm: string;
  staffName: string;
  staffLicenseNo: string;
  workSummary: string;
  totalAmount: string;
  restorationCostEstimate: string;
  /** 車台番号の下3桁を共有ページで聞く（任意） */
  requireVerifyLast3: boolean;
  /** 保証満了日（分かる場合。保存期間の判定に使う） */
  warrantyUntil: string;
  /** 施工種別モジュールの値 */
  moduleValues: Record<string, string>;
  /** 紐づける公開ブログ記事（任意） */
  blogPostId: string;
};

export type SaveResult = {
  ok?: true;
  certificateId?: string;
  error?: string;
  fieldErrors?: { fieldKey: string; message: string }[];
  /** 入力は通したが店舗に伝える注意（表現の警告・法定項目の欠け） */
  warnings?: string[];
};

function jstDate(ymd: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const d = new Date(`${ymd}T00:00:00+09:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function intOrNull(v: string): number | null {
  const t = v.trim();
  if (!t) return null;
  return /^\d{1,9}$/.test(t) ? Number(t) : null;
}

type StoreContext = { id: string; slug: string; facilityType: string; certificationNo: string };

/**
 * 下書きの作成・更新。発行済みは触れない。
 * 施工種別モジュールの必須チェック（法令の条件付き必須を含む）はここで行う。
 */
export async function saveCertificateDraft(
  store: StoreContext,
  input: CertificateCoreInput,
  certificateId?: string,
): Promise<SaveResult> {
  const serviceDate = jstDate(input.serviceDate);
  if (!serviceDate) return { error: "施工日を入力してください" };
  if (!input.staffName.trim()) return { error: "担当者名を入力してください" };
  if (!input.workSummary.trim()) return { error: "作業概要を入力してください" };
  if (input.workSummary.length > 2000) return { error: "作業概要は2000文字以内にしてください" };
  if (!CERTIFICATE_TYPES.some((t) => t.key === input.certificateType)) {
    return { error: "施工種別を選択してください" };
  }

  // 車両は自店の顧客に紐づいているものだけ（他店の車両に証明書を作れない）
  const link = await prisma.pitVehicleCustomer.findFirst({
    where: { vehicleId: input.vehicleId, endedOn: null, customer: { storeId: store.id } },
    select: { customerId: true, vehicle: { select: { id: true, chassisLast3: true } } },
  });
  if (!link) return { error: "車両が見つかりません。先に車両を登録してください" };

  const customerId = input.customerId.trim() || link.customerId;
  const customer = await prisma.pitCustomer.findFirst({
    where: { id: customerId, storeId: store.id },
    select: { id: true, name: true, address: true },
  });
  if (!customer) return { error: "依頼者が見つかりません" };

  // 施工種別モジュールの値（general は共通コアのみ）
  const mod = moduleDef(input.certificateType);
  const fieldErrors = mod ? validateModuleValues(mod.key, input.moduleValues) : [];
  if (fieldErrors.length > 0) return { error: "入力に不足があります", fieldErrors };

  const legalRecord = isLegalRecordFacility(store.facilityType);
  const warnings: string[] = [];
  // 施工種別の細目は任意。足りない・噛み合わない組み合わせは弾かずに伝える
  if (mod) warnings.push(...moduleAdvice(mod.key, input.moduleValues));
  // 店舗が書いた自由文は弾かずに警告する（生成文はブロック。copy-guard の強度分離）
  const copy = reviewCopy(input.workSummary, "user");
  if (copy.severity !== "ok") warnings.push(copy.message);
  if (legalRecord) {
    if (!customer.address) warnings.push("依頼者の住所が未入力です。法定記録簿には住所の記載が必要です");
    if (!store.certificationNo) warnings.push("店舗の認証番号が未登録です。記録簿に記載できません");
  }

  const data = {
    vehicleId: link.vehicle.id,
    storeId: store.id,
    customerId: customer.id,
    certificateType: input.certificateType,
    serviceDate,
    odometerKm: intOrNull(input.odometerKm),
    staffName: input.staffName.trim(),
    staffLicenseNo: input.staffLicenseNo.trim(),
    workSummary: input.workSummary.trim(),
    totalAmount: intOrNull(input.totalAmount),
    restorationCostEstimate: intOrNull(input.restorationCostEstimate),
    legalRecord,
    verifyLast3: input.requireVerifyLast3 ? (link.vehicle.chassisLast3 ?? "") : "",
    blogPostId: input.blogPostId.trim() || null,
    errorMessage: "",
  };

  let id = certificateId;
  if (id) {
    const existing = await prisma.pitCertificate.findFirst({
      where: { id, storeId: store.id },
      select: { status: true },
    });
    if (!existing) return { error: "証明書が見つかりません" };
    if (existing.status !== "draft" && existing.status !== "failed") {
      return { error: "発行済みの証明書は編集できません。訂正するには再発行してください" };
    }
    await prisma.pitCertificate.update({ where: { id }, data });
  } else {
    const created = await prisma.pitCertificate.create({
      // shareToken は発行時に作り直すが、unique 制約があるので下書きでも値を入れておく
      data: { ...data, shareToken: randomBytes(24).toString("base64url"), status: "draft" },
      select: { id: true },
    });
    id = created.id;
  }

  // モジュール値の入れ替え（定義に無いキーは保存しない）
  await prisma.pitCertificateDetail.deleteMany({ where: { certificateId: id } });
  if (mod) {
    const rows = mod.fields
      .map((f) => ({ f, value: (input.moduleValues[f.key] ?? "").trim() }))
      .filter((r) => r.value)
      .map((r) => ({
        certificateId: id!,
        module: mod.key,
        fieldKey: r.f.key,
        fieldValue: r.value,
        unit: r.f.unit ?? "",
      }));
    if (rows.length) await prisma.pitCertificateDetail.createMany({ data: rows });
  }

  return { ok: true, certificateId: id, warnings: warnings.length ? warnings : undefined };
}

/**
 * 発行。ハッシュを確定し、共有トークンを作り直し、保存期間を決める。
 * 失敗したら status=failed と errorMessage を残す（黙って消えない・再試行できる）。
 */
export async function issueCertificate(
  store: StoreContext,
  certificateId: string,
  opts: { warrantyUntil?: string } = {},
): Promise<{ ok?: true; error?: string; shareToken?: string }> {
  const cert = await prisma.pitCertificate.findFirst({
    where: { id: certificateId, storeId: store.id },
    select: {
      id: true,
      status: true,
      certificateType: true,
      serviceDate: true,
      odometerKm: true,
      staffName: true,
      workSummary: true,
      totalAmount: true,
      customerId: true,
      legalRecord: true,
      staffLicenseNo: true,
      customer: { select: { name: true, address: true } },
      vehicle: { select: { vehicleKey: true, vinEnc: true, regNumberEnc: true } },
      details: { select: { module: true, fieldKey: true, fieldValue: true } },
    },
  });
  if (!cert) return { error: "証明書が見つかりません" };
  if (cert.status === "issued") return { error: "すでに発行済みです" };
  if (cert.status === "voided") return { error: "無効化された証明書は発行できません" };

  // 認証/指定工場は法定記録簿を兼ねる。記載事項が欠けたものを「発行済み」にしない
  // （後から直せないため、発行前に止めるのが唯一の機会）
  const missing = missingLegalFields({
    facilityType: store.facilityType,
    certificationNo: store.certificationNo,
    hasVin: !!cert.vehicle.vinEnc,
    hasRegistrationNumber: !!cert.vehicle.regNumberEnc,
    customerName: cert.customer?.name ?? "",
    customerAddress: cert.customer?.address ?? "",
    serviceDate: cert.serviceDate,
    staffName: cert.staffName,
    workSummary: cert.workSummary,
  });
  if (missing.length > 0) {
    return {
      error: `法定記録簿に必要な記載事項が不足しています: ${missing.join("・")}（入力してから発行してください）`,
    };
  }

  try {
    const issuedAt = new Date();
    const payloadHash = certificatePayloadHash({
      vehicleKey: cert.vehicle.vehicleKey,
      storeSlug: store.slug,
      customerId: cert.customerId,
      certificateType: cert.certificateType,
      serviceDate: cert.serviceDate,
      odometerKm: cert.odometerKm,
      staffName: cert.staffName,
      workSummary: cert.workSummary,
      totalAmount: cert.totalAmount,
      details: cert.details,
      issuedAt,
    });
    const warranty = opts.warrantyUntil ? jstDate(opts.warrantyUntil) : null;
    const retention = resolveRetention({
      recordedOn: issuedAt,
      legalRecord: cert.legalRecord,
      warrantyUntil: warranty,
    });
    const shareToken = randomBytes(24).toString("base64url");
    await prisma.pitCertificate.update({
      where: { id: cert.id },
      data: {
        status: "issued",
        issuedAt,
        payloadHash,
        shareToken,
        shareRevoked: false,
        errorMessage: "",
        retentionUntil: retention.retentionUntil,
        retentionReason: retention.retentionReason,
      },
    });
    return { ok: true, shareToken };
  } catch (e) {
    const message = e instanceof Error ? e.message : "不明なエラー";
    // 沈黙させない: 失敗の事実と理由を残し、画面から再試行できる状態にする
    await prisma.pitCertificate
      .update({ where: { id: cert.id }, data: { status: "failed", errorMessage: message } })
      .catch(() => {});
    console.error("mbPIT: 証明書の発行に失敗", message);
    return { error: `発行に失敗しました（${message}）。もう一度お試しください` };
  }
}

/** 共有リンクの停止・再開（渡した相手に見せたくなくなった場合） */
export async function setShareRevoked(
  storeId: string,
  certificateId: string,
  revoked: boolean,
): Promise<{ ok?: true; error?: string }> {
  const cert = await prisma.pitCertificate.findFirst({
    where: { id: certificateId, storeId },
    select: { id: true },
  });
  if (!cert) return { error: "証明書が見つかりません" };
  await prisma.pitCertificate.update({ where: { id: cert.id }, data: { shareRevoked: revoked } });
  return { ok: true };
}

/**
 * 訂正。発行済みの内容は書き換えず、元を voided にして内容を引き継いだ下書きを作る。
 * （記録の履歴が残る形にする。上書きすると「いつ何が変わったか」が消える）
 */
export async function voidAndClone(
  store: StoreContext,
  certificateId: string,
  reason: string,
): Promise<{ ok?: true; error?: string; certificateId?: string }> {
  const cert = await prisma.pitCertificate.findFirst({
    where: { id: certificateId, storeId: store.id },
    include: { details: true },
  });
  if (!cert) return { error: "証明書が見つかりません" };
  if (!reason.trim()) return { error: "訂正の理由を入力してください" };

  const clone = await prisma.pitCertificate.create({
    data: {
      vehicleId: cert.vehicleId,
      storeId: cert.storeId,
      customerId: cert.customerId,
      shareToken: randomBytes(24).toString("base64url"),
      verifyLast3: cert.verifyLast3,
      serviceDate: cert.serviceDate,
      odometerKm: cert.odometerKm,
      staffName: cert.staffName,
      staffLicenseNo: cert.staffLicenseNo,
      workSummary: cert.workSummary,
      totalAmount: cert.totalAmount,
      restorationCostEstimate: cert.restorationCostEstimate,
      certificateType: cert.certificateType,
      legalRecord: cert.legalRecord,
      blogPostId: cert.blogPostId,
      replacesId: cert.id,
      status: "draft",
    },
    select: { id: true },
  });
  if (cert.details.length) {
    await prisma.pitCertificateDetail.createMany({
      data: cert.details.map((d) => ({
        certificateId: clone.id,
        module: d.module,
        fieldKey: d.fieldKey,
        fieldValue: d.fieldValue,
        unit: d.unit,
      })),
    });
  }
  await prisma.pitCertificate.update({
    where: { id: cert.id },
    data: { status: "voided", voidedAt: new Date(), voidReason: reason.trim(), shareRevoked: true },
  });
  return { ok: true, certificateId: clone.id };
}

// ── 参照 ────────────────────────────────────────────────

export type CertificateListRow = {
  id: string;
  status: string;
  certificateType: string;
  serviceDate: Date;
  issuedAt: Date | null;
  customerId: string;
  customerName: string;
  vehicleName: string;
  chassisLast3: string;
  errorMessage: string;
  shareRevoked: boolean;
};

export async function listStoreCertificates(storeId: string, take = 100): Promise<CertificateListRow[]> {
  const rows = await prisma.pitCertificate.findMany({
    where: { storeId },
    orderBy: [{ createdAt: "desc" }],
    take,
    select: {
      id: true,
      status: true,
      certificateType: true,
      serviceDate: true,
      issuedAt: true,
      errorMessage: true,
      shareRevoked: true,
      customer: { select: { id: true, name: true } },
      vehicle: { select: { vehicleName: true, chassisLast3: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    certificateType: r.certificateType,
    serviceDate: r.serviceDate,
    issuedAt: r.issuedAt,
    customerId: r.customer?.id ?? "",
    customerName: r.customer?.name ?? "",
    vehicleName: r.vehicle.vehicleName ?? "",
    chassisLast3: r.vehicle.chassisLast3 ?? "",
    errorMessage: r.errorMessage,
    shareRevoked: r.shareRevoked,
  }));
}

/** 未発行のまま残っている下書き（ホームで知らせる。作ったのに渡していない状態を放置しない） */
export async function countUnissuedDrafts(storeId: string): Promise<number> {
  return prisma.pitCertificate.count({ where: { storeId, status: { in: ["draft", "failed"] } } });
}

/** 自店の証明書1件（編集・詳細表示用。復号は行わない） */
export async function getStoreCertificate(storeId: string, certificateId: string) {
  return prisma.pitCertificate.findFirst({
    where: { id: certificateId, storeId },
    include: {
      details: true,
      customer: { select: { id: true, name: true, address: true, tel: true } },
      vehicle: {
        select: {
          id: true,
          vehicleName: true,
          maker: true,
          modelCode: true,
          chassisLast3: true,
          firstRegisteredOn: true,
        },
      },
      store: {
        select: {
          displayName: true, address: true, tel: true, certificationNo: true, facilityType: true,
          // 帳票の体裁・記載範囲の店舗設定（判定は cert-display.ts）
          certBrandName: true, certShowCustomerName: true, certShowCustomerAddress: true,
          certShowCustomerTel: true, certShowAmount: true,
        },
      },
    },
  });
}

/** 証明書番号（発行済みのみ。下書きは番号を持たない） */
export function certificateNumberOf(cert: { id: string; issuedAt: Date | null }): string {
  return cert.issuedAt ? certificateNo(cert.id, cert.issuedAt) : "";
}

/**
 * 共有トークンからの参照（ログイン不要ページ用）。
 * 発行済み・停止されていないものだけを返す。下3桁の照合が設定されていれば一致を要求する。
 */
export async function getSharedCertificate(
  token: string,
  last3?: string,
): Promise<
  | { state: "ok"; cert: NonNullable<Awaited<ReturnType<typeof getStoreCertificate>>> }
  | { state: "notfound" }
  | { state: "revoked" }
  | { state: "needs_verify" }
> {
  const cert = await prisma.pitCertificate.findUnique({
    where: { shareToken: token },
    include: {
      details: true,
      customer: { select: { id: true, name: true, address: true, tel: true } },
      vehicle: {
        select: {
          id: true,
          vehicleName: true,
          maker: true,
          modelCode: true,
          chassisLast3: true,
          firstRegisteredOn: true,
        },
      },
      store: {
        select: {
          displayName: true, address: true, tel: true, certificationNo: true, facilityType: true,
          // 帳票の体裁・記載範囲の店舗設定（判定は cert-display.ts）
          certBrandName: true, certShowCustomerName: true, certShowCustomerAddress: true,
          certShowCustomerTel: true, certShowAmount: true,
        },
      },
    },
  });
  if (!cert || cert.status !== "issued") return { state: "notfound" };
  if (cert.shareRevoked) return { state: "revoked" };
  if (cert.verifyLast3 && cert.verifyLast3 !== (last3 ?? "").trim()) return { state: "needs_verify" };
  return { state: "ok", cert };
}
