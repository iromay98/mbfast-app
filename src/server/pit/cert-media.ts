/*
 * 施工証明書の証跡写真（PitCertificateMedia）。
 *
 * 方針:
 *  - 写真は**認可付きルートでのみ配信**する。公開URLは持たない（保存キーは推測不能）。
 *  - 公開してよいのは cert-visibility の許可リストにある種別だけ（デフォルト除外）。
 *    さらに店舗が明示的に「公開可」を付けたものに限る。
 *  - 発行済みの証明書には写真を足さない・消さない（内容が確定しているため）。
 *    間違いは訂正再発行（無効化＋新しい下書き）で直す。
 *  - EXIF は保存前に落とす（撮影場所が残ると、公開しない写真でも流出時の被害が大きい）。
 *
 * この層以外から PitCertificateMedia を触らない（storeIdの確認と種別の検査を通す唯一の入口）。
 */
import { prisma } from "@/lib/db";
import { storage } from "@/server/storage";
import { processPhoto, PIT_IMAGE_MIME } from "./images";
import { isCertOnlyMediaKind, isPublicAllowedMediaKind } from "./cert-visibility";

/** 証跡写真の種別。写真OCRの対象キー（photo-ocr.ts）と語彙を揃えている */
export const CERT_MEDIA_KINDS: { key: string; label: string; help?: string; publicable: boolean }[] = [
  { key: "before", label: "施工前", publicable: true },
  { key: "after", label: "施工後", publicable: true },
  { key: "product_label", label: "製品ラベル", help: "ロット番号・製品名が写ったもの", publicable: true },
  { key: "tire", label: "タイヤ側面", help: "DOT・銘柄・サイズ", publicable: true },
  { key: "meter", label: "メーター", help: "走行距離。証明書の記録用（公開しない）", publicable: false },
  { key: "device_screen", label: "測定器の画面", help: "SOH等。機種により車台番号が写る", publicable: false },
  { key: "vehicle_plate", label: "ナンバープレート", help: "証跡専用。公開しない", publicable: false },
  { key: "diagnostic_screen", label: "診断機の画面", help: "証跡専用。公開しない", publicable: false },
  { key: "other", label: "その他", help: "公開はしない（内容が特定できないため）", publicable: false },
];

export function certMediaKindLabel(kind: string): string {
  return CERT_MEDIA_KINDS.find((k) => k.key === kind)?.label ?? kind;
}

export function isKnownCertMediaKind(kind: string): boolean {
  return CERT_MEDIA_KINDS.some((k) => k.key === kind);
}

export type CertMediaRow = {
  id: string;
  kind: string;
  kindLabel: string;
  isPublicSafe: boolean;
  /** 公開に回せる種別か（isPublicSafe を立てられるか） */
  publicable: boolean;
  takenAt: Date | null;
  createdAt: Date;
};

/** 1証明書あたりの上限（際限なく貯めさせない） */
export const MAX_CERT_MEDIA = 12;

async function certificateOfStore(certificateId: string, storeId: string) {
  return prisma.pitCertificate.findFirst({
    where: { id: certificateId, storeId },
    select: { id: true, status: true },
  });
}

export async function listCertificateMedia(
  certificateId: string,
  storeId: string,
): Promise<CertMediaRow[]> {
  const cert = await certificateOfStore(certificateId, storeId);
  if (!cert) return [];
  const rows = await prisma.pitCertificateMedia.findMany({
    where: { certificateId },
    orderBy: { createdAt: "asc" },
    select: { id: true, kind: true, isPublicSafe: true, takenAt: true, createdAt: true },
  });
  return rows.map((r) => ({
    ...r,
    kindLabel: certMediaKindLabel(r.kind),
    publicable: isPublicAllowedMediaKind(r.kind),
  }));
}

/*
 * 写真を追加する。
 * 公開可フラグは「許可リストにある種別」かつ「呼び出し側が明示的に true を渡した」ときだけ立つ。
 */
export async function addCertificateMedia(input: {
  certificateId: string;
  storeId: string;
  kind: string;
  file: File;
  wantPublic: boolean;
}): Promise<{ ok?: true; error?: string; id?: string }> {
  const cert = await certificateOfStore(input.certificateId, input.storeId);
  if (!cert) return { error: "証明書が見つかりません" };
  if (cert.status !== "draft" && cert.status !== "failed") {
    return { error: "発行済みの証明書には写真を追加できません（訂正は再発行で行います）" };
  }
  if (!isKnownCertMediaKind(input.kind)) return { error: "写真の種類を選んでください" };

  const count = await prisma.pitCertificateMedia.count({ where: { certificateId: input.certificateId } });
  if (count >= MAX_CERT_MEDIA) return { error: `写真は${MAX_CERT_MEDIA}枚までです` };

  if (input.file.size === 0) return { error: "ファイルを選択してください" };
  if (!input.file.type.startsWith("image/")) return { error: "画像ファイルを選んでください" };

  let buffer: Buffer;
  try {
    // WebPへ正規化しつつEXIFを落とす（images.ts が公開画像と同じ処理を持つ）
    const processed = await processPhoto(Buffer.from(await input.file.arrayBuffer()));
    buffer = processed.buffer;
  } catch {
    return { error: "画像を処理できませんでした。別の写真でお試しください" };
  }

  // 保存キーは推測不能（公開ディレクトリには置かない）
  const key = `pit/cert-media/${crypto.randomUUID().replace(/-/g, "")}.webp`;
  await storage.save(key, buffer, PIT_IMAGE_MIME);

  const created = await prisma.pitCertificateMedia.create({
    data: {
      certificateId: input.certificateId,
      storageKey: key,
      kind: input.kind,
      // 種別が許可リストに無ければ、要求されても公開可にしない
      isPublicSafe: input.wantPublic && isPublicAllowedMediaKind(input.kind),
      hash: "",
    },
    select: { id: true },
  });
  return { ok: true, id: created.id };
}

export async function setCertificateMediaPublic(
  mediaId: string,
  storeId: string,
  wantPublic: boolean,
): Promise<{ ok?: true; error?: string }> {
  const m = await prisma.pitCertificateMedia.findFirst({
    where: { id: mediaId, certificate: { storeId } },
    select: { id: true, kind: true, certificate: { select: { status: true } } },
  });
  if (!m) return { error: "写真が見つかりません" };
  if (m.certificate.status === "issued") {
    return { error: "発行済みの証明書の写真は変更できません" };
  }
  if (wantPublic && !isPublicAllowedMediaKind(m.kind)) {
    return { error: `${certMediaKindLabel(m.kind)}は公開できません（証跡専用）` };
  }
  await prisma.pitCertificateMedia.update({ where: { id: mediaId }, data: { isPublicSafe: wantPublic } });
  return { ok: true };
}

export async function deleteCertificateMedia(
  mediaId: string,
  storeId: string,
): Promise<{ ok?: true; error?: string }> {
  const m = await prisma.pitCertificateMedia.findFirst({
    where: { id: mediaId, certificate: { storeId } },
    select: { id: true, storageKey: true, certificate: { select: { status: true } } },
  });
  if (!m) return { error: "写真が見つかりません" };
  if (m.certificate.status === "issued") {
    return { error: "発行済みの証明書の写真は削除できません（訂正は再発行で行います）" };
  }
  await prisma.pitCertificateMedia.delete({ where: { id: mediaId } });
  await storage.delete(m.storageKey);
  return { ok: true };
}

/*
 * 配信用の読み出し。
 * scope="store" は自店（本部は storeId 指定）で全種別、
 * scope="public" は共有ページ用で**公開可の写真だけ**（種別の許可リストも通す）。
 */
export async function readCertificateMediaFile(
  mediaId: string,
  where: { scope: "store"; storeId: string } | { scope: "public"; shareToken: string },
): Promise<{ buffer: Buffer; contentType: string } | null> {
  const m = await prisma.pitCertificateMedia.findFirst({
    where:
      where.scope === "store"
        ? { id: mediaId, certificate: { storeId: where.storeId } }
        : {
            id: mediaId,
            isPublicSafe: true,
            certificate: { shareToken: where.shareToken, status: "issued", shareRevoked: false },
          },
    select: { storageKey: true, kind: true },
  });
  if (!m) return null;
  // 公開経路は種別の許可リストでもう一度弾く（DBのフラグが誤っていても漏らさない）
  if (where.scope === "public" && (!isPublicAllowedMediaKind(m.kind) || isCertOnlyMediaKind(m.kind))) {
    return null;
  }
  const file = await storage.read(m.storageKey);
  if (!file) return null;
  return { buffer: file.buffer, contentType: file.contentType || PIT_IMAGE_MIME };
}

/** 共有ページに出す写真の一覧（公開可のみ） */
export async function listPublicCertificateMedia(
  shareToken: string,
): Promise<{ id: string; kindLabel: string }[]> {
  const rows = await prisma.pitCertificateMedia.findMany({
    where: {
      isPublicSafe: true,
      certificate: { shareToken, status: "issued", shareRevoked: false },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, kind: true },
  });
  return rows
    .filter((r) => isPublicAllowedMediaKind(r.kind))
    .map((r) => ({ id: r.id, kindLabel: certMediaKindLabel(r.kind) }));
}
