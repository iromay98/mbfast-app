/*
 * 施工証明書 → 施工ブログ投稿の導線（下書きスタンバイ）。
 *
 * 施工証明を「下書き保存」した時点で、施工ブログの下書き(PitPost.status="draft")を
 * 投稿一覧にスタンバイさせる。加盟店が「投稿する」を押すと、通常の投稿フォーム
 * （音声メモ＋写真）に車種・カテゴリを引き継いで公開できる。
 *
 * **公開ブログに渡してよいのは公開可の情報だけ**。ここで証明書から持ち込むのは
 *   - 車種（メーカー＋車種名。車台番号や登録番号は持ち込まない）
 *   - カテゴリ（施工種別を投稿カテゴリに変換）
 * の2つだけ。氏名・住所・連絡先・車台番号・金額・非公開写真は一切持ち込まない
 * （そもそもこの関数はそれらを引数に取らない＝構造的に漏れない）。写真は投稿フォームで
 * 加盟店が選ぶ（証明書の証跡写真の自動流用はしない）。
 */
import { prisma } from "@/lib/db";

/** 施工種別 → 投稿ジャンル（公式8ジャンルslug。定義は src/config/mbpit-genres.json） */
export const CERT_TO_BLOG_CATEGORY: Record<string, string> = {
  coating: "coating",
  ecu: "ecu",
  aiming: "maintenance",
  tire: "tire-wheel",
  repair_history: "maintenance",
  battery: "maintenance",
  general: "maintenance",
};

export function blogCategoryForCertType(certType: string): string {
  return CERT_TO_BLOG_CATEGORY[certType] ?? "maintenance";
}

/** 公開してよい車種表記だけを組み立てる（メーカー＋車種名。無ければ「車両」） */
export function publicVehicleLabel(v: { maker?: string | null; vehicleName?: string | null }): string {
  const label = [v.maker ?? "", v.vehicleName ?? ""]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ")
    .trim();
  return label || "車両";
}

/**
 * 証明書の下書きに対して、施工ブログの下書き(PitPost)を1件用意する（べき等）。
 *
 * - 既に blogPostId が紐付いていれば何もしない（二重作成・投稿後の復活を防ぐ）
 * - 下書き(status="draft"/"failed")の証明書だけを対象にする
 * - 失敗しても証明書の保存自体は止めない（呼び出し側で握りつぶす）
 */
export async function ensureBlogDraftForCertificate(
  storeId: string,
  certificateId: string,
): Promise<{ created?: true; blogPostId?: string } | { skipped: string }> {
  const cert = await prisma.pitCertificate.findFirst({
    where: { id: certificateId, storeId },
    select: {
      id: true,
      status: true,
      blogPostId: true,
      certificateType: true,
      vehicle: { select: { maker: true, vehicleName: true } },
    },
  });
  if (!cert) return { skipped: "証明書が見つかりません" };
  // 発行済み・無効化済みには新たにスタンバイを作らない（下書き段階の導線）
  if (cert.status !== "draft" && cert.status !== "failed") return { skipped: "下書きではありません" };
  // 既に紐付け済み（作成済み or 投稿済みで公開記事に張り替え済み）なら何もしない
  if (cert.blogPostId) return { skipped: "すでに紐付いています" };

  const post = await prisma.pitPost.create({
    data: {
      storeId,
      vehicle: publicVehicleLabel(cert.vehicle),
      category: blogCategoryForCertType(cert.certificateType),
      status: "draft",
      // 写真・メモは投稿時に加盟店が入れる（証明書の非公開情報は持ち込まない）
      photoKeys: [],
    },
    select: { id: true },
  });
  await prisma.pitCertificate.update({
    where: { id: cert.id },
    data: { blogPostId: post.id },
  });
  return { created: true, blogPostId: post.id };
}

/**
 * スタンバイ下書きを実際の投稿へ引き継ぐ。
 * 公開/保留に成功したら、証明書の紐付けを本物の記事へ張り替え、空のスタンバイ下書きを消す。
 * （投稿は通常どおり新しい PitPost を作るため、プレースホルダは用済みになる）
 */
export async function consumeStagedDraft(
  storeId: string,
  stagedPostId: string,
  realPostId: string,
): Promise<void> {
  if (stagedPostId === realPostId) return;
  // このスタンバイを指している自店の証明書を本物の記事へ張り替える
  await prisma.pitCertificate.updateMany({
    where: { blogPostId: stagedPostId, storeId },
    data: { blogPostId: realPostId },
  });
  // プレースホルダ（下書き）だけを消す。誤って公開済みを消さないよう status で守る
  await prisma.pitPost.deleteMany({ where: { id: stagedPostId, storeId, status: "draft" } });
}
