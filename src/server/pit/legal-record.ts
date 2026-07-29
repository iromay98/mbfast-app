/*
 * 法定記録簿モード（認証工場・指定工場）の要件チェックとエクスポート。
 *
 * 方針:
 *  - 記録簿として成立しないものを「発行済み」にしない。認証/指定工場では法定記載事項が
 *    欠けていたら発行を止める（一般の事業場は証明書のみなので対象外）
 *  - 何が必須かは cert-fields.ts の legalRequired が原本（法令改正時はそこだけ直す）
 *  - **加盟店が退会しても記録の保存義務は事業者本人に残る**ため、記録を持ち出せる形で
 *    出せることを機能として保証する（退会・停止の前にエクスポートできる）
 *  - エクスポートには車台番号を含む。復号は監査ログ必須の経路のみを通す
 */
import { prisma } from "@/lib/db";
import { CORE_FIELDS, isLegalRecordFacility } from "@/server/pit/cert-fields";
import { certificateNumberOf, certificateTypeLabel } from "@/server/pit/certificate";
import { moduleDef } from "@/server/pit/cert-fields";
import { readVehicleSecrets } from "@/server/pit/vehicle-register";

/** 法定記載事項のうち、この実装で値を持つ項目（cert-fields の legalRequired が原本） */
export const LEGAL_REQUIRED_KEYS = CORE_FIELDS.filter((f) => f.legalRequired).map((f) => f.key);

export type LegalCheckSource = {
  facilityType: string;
  certificationNo: string;
  /** 車台番号が暗号化保存されているか（値は見ない＝復号しないで判定する） */
  hasVin: boolean;
  /** 登録番号が保存されているか（登録番号の無い車両もあるため、車台番号とどちらかで可） */
  hasRegistrationNumber: boolean;
  customerName: string;
  customerAddress: string;
  serviceDate: Date | null;
  staffName: string;
  workSummary: string;
};

/**
 * 法定記録簿として必要な記載事項が揃っているか。
 * 揃っていない項目名の一覧を返す（空なら発行してよい）。
 */
export function missingLegalFields(src: LegalCheckSource): string[] {
  if (!isLegalRecordFacility(src.facilityType)) return [];
  const missing: string[] = [];
  const label = (key: string) => CORE_FIELDS.find((f) => f.key === key)?.label ?? key;

  // 登録自動車は登録番号、それ以外は車台番号で車両を特定する（どちらか必須）
  if (!src.hasVin && !src.hasRegistrationNumber) missing.push("車台番号または登録番号");
  if (!src.customerName.trim()) missing.push(label("customerName"));
  if (!src.customerAddress.trim()) missing.push(label("customerAddress"));
  if (!src.serviceDate) missing.push(label("serviceDate"));
  if (!src.staffName.trim()) missing.push(label("staffName"));
  if (!src.workSummary.trim()) missing.push(label("workSummary"));
  if (!src.certificationNo.trim()) missing.push(label("certificationNo"));
  return missing;
}

// ── 記録の一括エクスポート（退会・廃業・監査対応） ──

const CSV_HEADER = [
  "証明書番号",
  "状態",
  "記載日（発行日）",
  "施工日",
  "施工種別",
  "法定記録簿",
  "車名",
  "型式",
  "車台番号",
  "登録番号",
  "初度登録年月",
  "施工時走行距離",
  "依頼者氏名",
  "依頼者住所",
  "依頼者連絡先",
  "施工店",
  "認証番号",
  "担当者",
  "資格番号",
  "作業概要",
  "施工金額",
  "再施工費用の目安",
  "施工種別の記載事項",
  "保存期限",
  "保存理由",
  "無効化日",
  "無効化理由",
  "訂正元の証明書ID",
  "記録ハッシュ",
];

function csvCell(v: string | number | null | undefined): string {
  const s = v === null || v === undefined ? "" : String(v);
  // Excelが数式と解釈しないように先頭の = + - @ を無効化する（CSVインジェクション対策）
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

function ymd(d: Date | null): string {
  if (!d) return "";
  const j = new Date(d.getTime() + 9 * 3600 * 1000);
  return `${j.getUTCFullYear()}-${String(j.getUTCMonth() + 1).padStart(2, "0")}-${String(j.getUTCDate()).padStart(2, "0")}`;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "下書き",
  issued: "発行済み",
  voided: "無効",
  failed: "発行失敗",
};

export type ExportContext = {
  actorUserId: string;
  actorRole: string;
  /** 監査ログに残す目的（退会時エクスポート・本部の記録出力など） */
  purpose: string;
};

/**
 * 店舗の記録をCSVで出す。
 * 発行済み・無効化済みを含める（記録として残っているものはすべて持ち出せる）。
 * 下書きは記録ではないので含めない。
 */
export async function exportStoreRecordsCsv(
  storeId: string,
  ctx: ExportContext,
): Promise<{ csv: string; count: number; storeName: string }> {
  const store = await prisma.pitStore.findUnique({
    where: { id: storeId },
    select: { displayName: true, certificationNo: true },
  });
  const certs = await prisma.pitCertificate.findMany({
    where: { storeId, status: { in: ["issued", "voided"] } },
    orderBy: [{ issuedAt: "asc" }, { createdAt: "asc" }],
    include: {
      details: true,
      customer: { select: { name: true, address: true, tel: true } },
      vehicle: {
        select: { id: true, vehicleName: true, maker: true, modelCode: true, firstRegisteredOn: true },
      },
    },
  });

  const rows: string[] = [CSV_HEADER.map(csvCell).join(",")];
  for (const c of certs) {
    // 車台番号・登録番号は復号（1件ごとに監査ログが残る）
    const secrets = await readVehicleSecrets(c.vehicle.id, {
      actorUserId: ctx.actorUserId,
      actorRole: ctx.actorRole,
      purpose: ctx.purpose,
      certificateId: c.id,
    });
    const details = c.details
      .map((d) => {
        const label = moduleDef(d.module)?.fields.find((f) => f.key === d.fieldKey)?.label ?? d.fieldKey;
        return `${label}: ${d.fieldValue}${d.unit ? ` ${d.unit}` : ""}`;
      })
      .join(" / ");

    rows.push(
      [
        certificateNumberOf(c),
        STATUS_LABEL[c.status] ?? c.status,
        ymd(c.issuedAt),
        ymd(c.serviceDate),
        certificateTypeLabel(c.certificateType),
        c.legalRecord ? "対象" : "",
        [c.vehicle.maker, c.vehicle.vehicleName].filter(Boolean).join(" "),
        c.vehicle.modelCode ?? "",
        secrets.vin ?? "",
        secrets.registrationNumber ?? "",
        c.vehicle.firstRegisteredOn ? ymd(c.vehicle.firstRegisteredOn).slice(0, 7) : "",
        c.odometerKm ?? "",
        c.customer?.name ?? "",
        c.customer?.address ?? "",
        c.customer?.tel ?? "",
        store?.displayName ?? "",
        store?.certificationNo ?? "",
        c.staffName,
        c.staffLicenseNo,
        c.workSummary,
        c.totalAmount ?? "",
        c.restorationCostEstimate ?? "",
        details,
        ymd(c.retentionUntil),
        c.retentionReason,
        ymd(c.voidedAt),
        c.voidReason,
        c.replacesId ?? "",
        c.payloadHash,
      ]
        .map(csvCell)
        .join(","),
    );
  }

  // ExcelでUTF-8と認識させるためBOMを付ける（付けないと日本語が化ける）
  return { csv: `﻿${rows.join("\r\n")}\r\n`, count: certs.length, storeName: store?.displayName ?? "" };
}

/** 退会・停止の前に伝えるべきこと（記録の保存義務は事業者本人に残る） */
export async function retentionSummary(storeId: string): Promise<{
  total: number;
  legalRecords: number;
  keepUntil: Date | null;
  unissued: number;
}> {
  const [total, legalRecords, longest, unissued] = await Promise.all([
    prisma.pitCertificate.count({ where: { storeId, status: { in: ["issued", "voided"] } } }),
    prisma.pitCertificate.count({ where: { storeId, legalRecord: true, status: "issued" } }),
    prisma.pitCertificate.findFirst({
      where: { storeId, retentionUntil: { not: null } },
      orderBy: { retentionUntil: "desc" },
      select: { retentionUntil: true },
    }),
    prisma.pitCertificate.count({ where: { storeId, status: { in: ["draft", "failed"] } } }),
  ]);
  return { total, legalRecords, keepUntil: longest?.retentionUntil ?? null, unissued };
}
